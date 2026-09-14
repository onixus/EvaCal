import { test, expect, type Page } from '@playwright/test';
import { createCalculationViaWizard, createProject, E2E_PASSWORD, loginAs } from './helpers';

/**
 * Подпись на текущем этапе ревью: роль входит, открывает первый комплект своей
 * очереди и утверждает его. Этапов два и роли у них разные — тех.писатель
 * подписывает нормоконтроль, ГАП утверждает выпуск.
 */
async function signReview(
  page: Page,
  username: string,
  password: string,
  reviewerName: string,
): Promise<void> {
  await loginAs(page, username, password);
  await page.goto('/review');
  await page.locator('a[href^="/review/"]').first().click();
  await page.waitForURL(/\/review\/[a-z0-9]+/i, { timeout: 20000 });

  await page.getByPlaceholder('ФИО и должность').fill(reviewerName);
  await page.getByRole('button', { name: 'Утвердить комплект' }).click();
  await page.getByRole('button', { name: 'Отправить решение' }).click();
  await expect(page.getByRole('button', { name: 'Отправить решение' })).toHaveCount(0, {
    timeout: 20000,
  });
}

test.describe('RR-6: Severny Bank GOST 34 Release Flow', () => {
  test.setTimeout(240000);
  const PROJECT_NAME = 'Северный банк (e2e)';
  const CUSTOMER_NAME = 'ПАО Северный банк';

  test('login, create project, create calculation, release GOST 34 package, and approve', async ({
    page,
  }) => {
    test.setTimeout(300000); // Flow is long, give it 5 minutes
    test.skip(!E2E_PASSWORD, 'E2E_ARCHITECT_PASSWORD не задан');
    const password = E2E_PASSWORD as string;

    // 1. Вход архитектором: после входа — рабочий стол с конвейером проектов.
    const architectPassword = await loginAs(page, 'architect', password);
    await expect(page.getByRole('heading', { level: 1, name: 'Рабочий стол' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Конвейер проектов' })).toBeVisible();

    // 2–3. Проект и его карточка.
    await createProject(page, PROJECT_NAME, CUSTOMER_NAME);
    // Карточка показывает конвейер проекта (на свежем стенде — первый шаг).
    await expect(page.getByRole('list', { name: 'Этапы проекта' })).toBeVisible();

    // 4–5. Расчёт через пресейл-мастер.
    await createCalculationViaWizard(page);

    // 6. Из расчёта — в Студию ГОСТ 34.
    const studioLink = page.locator('a[title*="профиль, требования"]');
    await expect(studioLink).toBeVisible({ timeout: 15000 });
    await studioLink.click();

    // 7. GOST 34 Studio Wizard
    try {
      await expect(page.getByText('Редакция нормативного профиля')).toBeVisible({ timeout: 15000 });
    } catch (e) {
      await page.screenshot({ path: 'studio-hang.png' });
      throw e;
    }
    const nextBtn = page.getByRole('button', { name: 'Далее' });

    // Step 1 (Profile) -> 2 (Requirements)
    await nextBtn.click();

    // Select fintech preset!
    await page
      .getByRole('button', { name: /Выбрать шаблон ТЗ/i })
      .first()
      .click();
    await expect(page.getByRole('button', { name: /Финтех/i })).toBeVisible();
    await page.getByRole('button', { name: /Финтех/i }).click();
    await page.getByRole('button', { name: /Применить шаблон/i }).click();

    await expect(page.locator('.nums').first()).not.toHaveText('0', { timeout: 10000 });

    // Step 2 -> 3
    await nextBtn.click();
    await expect(page.getByText('Применимость нормативных требований').first()).toBeVisible();

    // Step 3 -> 4
    await nextBtn.click();
    await expect(page.getByText('Трассируемость требований').first()).toBeVisible();

    // Step 4 -> 5
    await nextBtn.click();
    await expect(page.getByText('Реквизиты и подписи').first()).toBeVisible();

    // FILL REQUIRED SIGNATURES SO EXPORT IS NOT BLOCKED!
    const fioInputs = page.locator('input[placeholder="ФИО"]');
    const fioCount = await fioInputs.count();
    for (let i = 0; i < fioCount; i++) {
      await fioInputs.nth(i).fill('Иванов И.И.');
    }

    // Step 5 -> 6
    await nextBtn.click();
    await expect(page.getByText('Предпросмотр и интерактивная правка').first()).toBeVisible();

    // Go to Compliance (Step 7)
    await page.getByRole('button', { name: /Выпустить комплект/i }).click();

    // 8. Compliance & Release
    await expect(page.getByText('Готово к выпуску')).toBeVisible({ timeout: 15000 });

    // Release
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Весь комплект (ZIP)' }).click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/\.zip$/);

    // 9. Карточка проекта: конвейер показывает нормоконтроль, комплект — в реестре.
    await page.goto('/projects');
    await page.getByRole('link', { name: PROJECT_NAME }).first().click();
    await expect(page.getByRole('heading', { name: PROJECT_NAME })).toBeVisible();
    await expect(
      page.getByRole('list', { name: 'Этапы проекта' }).locator('[aria-current="step"]'),
    ).toContainText('Нормоконтроль');

    // Switch to Packages tab!
    await page.locator('button').filter({ hasText: 'Реестр ГОСТ 34' }).first().click();

    // Архитектор выпустил комплект и потому подписи под ним не ставит: карточка
    // проекта показывает ему только этап, на котором комплект стоит.
    await expect(page.getByText(/на подписи:/i).first()).toBeVisible();
    await expect(page.getByRole('button', { name: '✓ Согласовать' })).toHaveCount(0);

    // Доска заявок: комплект стоит в колонке нормоконтроля, архитектор его не двигает.
    await page.goto('/board');
    const twColumn = page.getByRole('region', { name: 'Нормоконтроль' });
    await expect(
      twColumn.locator('article').filter({ hasText: CUSTOMER_NAME }).first(),
    ).toBeVisible();

    // Нормоконтроль подписывает тех.писатель — не архитектор и не ГАП.
    // Пароль у всех сидированных учёток один (SEED_DEFAULT_PASSWORD в пайплайне).
    // После его решения комплект уходит на финальный этап, где его утверждает
    // Заказчик по share-ссылке (ниже) либо ГАП в системе.
    await signReview(page, 'techwriter', password, 'Васильева Е.И. (нормоконтроль)');

    // Возврат в роль архитектора: share-ссылку выпускает он.
    await loginAs(page, 'architect', architectPassword);
    await page.goto('/projects');
    await page.getByRole('link', { name: PROJECT_NAME }).first().click();
    await expect(page.getByRole('heading', { name: PROJECT_NAME })).toBeVisible();
    await page.locator('button').filter({ hasText: 'Реестр ГОСТ 34' }).first().click();

    try {
      await expect(page.getByRole('button', { name: /Поделиться/i }).first()).toBeVisible({
        timeout: 15000,
      });
    } catch (e) {
      await page.screenshot({ path: 'share-button-error.png' });
      throw e;
    }
    await page
      .getByRole('button', { name: /Поделиться/i })
      .first()
      .click();

    const shareInput = page.locator('input[readonly]');
    await expect(shareInput).not.toHaveValue('', { timeout: 10000 });
    const shareUrl = await shareInput.inputValue();
    expect(shareUrl).toContain('/review/');

    // 10. Customer Approval Portal
    const customerContext = await page.context().browser()!.newContext();
    const customerPage = await customerContext.newPage();

    await customerPage.goto(shareUrl);

    const [customerDownload] = await Promise.all([
      customerPage.waitForEvent('download'),
      customerPage.getByRole('link', { name: /скачать ZIP/i }).click(),
    ]);
    expect(customerDownload.suggestedFilename()).toMatch(/\.zip$/);
    await customerPage.screenshot({ path: 'customer-portal.png' });

    await customerPage.getByRole('button', { name: /Утвердить комплект/i }).click();
    await customerPage.getByPlaceholder('ФИО и должность').fill('Иван Иванов, Директор');
    await customerPage.getByRole('button', { name: /Отправить решение/i }).click();
    await expect(customerPage.getByText('Комплект утверждён')).toBeVisible();

    await customerContext.close();

    // 11. После утверждения конвейер проекта стоит на «Выпущен».
    await page.goto('/projects');
    await page.getByRole('link', { name: PROJECT_NAME }).first().click();
    await expect(
      page.getByRole('list', { name: 'Этапы проекта' }).locator('[aria-current="step"]'),
    ).toContainText('Выпущен');
  });
});
