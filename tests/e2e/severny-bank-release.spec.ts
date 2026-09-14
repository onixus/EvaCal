import { test, expect, type Page } from '@playwright/test';

// Пароль стендовых учёток берётся из окружения: общего дефолтного пароля в проекте нет.
// Пайплайн сидит все роли одним паролем (SEED_DEFAULT_PASSWORD), поэтому им же
// логинятся тех.писатель и ГАП.
const E2E_PASSWORD = process.env.E2E_ARCHITECT_PASSWORD;

/** Пароль, на который меняется выданный сидом при первом входе. */
const FORCED_NEW_PASSWORD = 'newsecurepassword123';

/**
 * Вход под ролью с прохождением обязательной смены пароля.
 * Возвращает пароль, действующий после входа: сид помечает учётки
 * `mustChangePassword`, и первый вход всегда заканчивается сменой.
 */
async function loginAs(page: Page, username: string, password: string): Promise<string> {
  await page.goto('/login');
  const inputs = page.locator('.input');
  await inputs.nth(0).fill(username);
  await inputs.nth(1).fill(password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(projects|review|presale|admin|account)/, { timeout: 20000 });

  if (/account/.test(page.url())) {
    const passInputs = page.locator('input[type="password"]');
    await passInputs.nth(0).fill(password);
    await passInputs.nth(1).fill(FORCED_NEW_PASSWORD);
    await page.getByRole('button', { name: /Сменить пароль/i }).click();
    await expect(page.getByText('Пароль изменён')).toBeVisible({ timeout: 15000 });
    return FORCED_NEW_PASSWORD;
  }
  return password;
}

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
    context,
  }) => {
    test.setTimeout(300000); // Flow is long, give it 5 minutes
    test.skip(!E2E_PASSWORD, 'E2E_ARCHITECT_PASSWORD не задан');
    const password = E2E_PASSWORD as string;

    // 1. Login as architect
    await page.goto('/login');
    const inputs = page.locator('.input');
    await inputs.nth(0).fill('architect');
    await inputs.nth(1).fill(password);
    await page.click('button[type="submit"]');

    // Wait for either navigation or an error message to appear
    const errorLocator = page
      .locator('text=Неверный логин или пароль')
      .or(page.locator('text=Ошибка'));
    try {
      await Promise.race([
        page.waitForURL(/.*\/projects|.*\/account/, { timeout: 10000 }),
        errorLocator.waitFor({ state: 'visible', timeout: 10000 }).then(async () => {
          const errText = await errorLocator.innerText();
          throw new Error(`Login failed: ${errText}`);
        }),
      ]);
    } catch (err) {
      await page.screenshot({ path: 'login-hang.png' });
      throw err;
    }

    // Handle initial forced password change if redirected to /account
    let architectPassword = password;
    if (/account/.test(page.url())) {
      const passInputs = page.locator('input[type="password"]');
      await passInputs.nth(0).fill(password);
      await passInputs.nth(1).fill(FORCED_NEW_PASSWORD);
      await page.getByRole('button', { name: /Сменить пароль/i }).click();
      await expect(page.getByText('Пароль изменён')).toBeVisible();
      architectPassword = FORCED_NEW_PASSWORD;
      await page.goto('/projects');
    }

    await expect(page).toHaveURL(/.*\/projects/);

    // 2. Create Project
    await page.getByRole('button', { name: 'Новый проект' }).click();
    await expect(page.getByText('Создать новый проект')).toBeVisible();

    // Fill project form (wait for inputs to be available in modal)
    // using label queries or generic input selectors since they are just basic inputs
    await page
      .locator('input[placeholder*="Название проекта"]')
      .or(page.locator('input[placeholder*="АС «Единый"]'))
      .fill(PROJECT_NAME);
    await page
      .locator('input[placeholder*="Заказчик"]')
      .or(page.locator('input[placeholder*="Северный банк"]'))
      .fill(CUSTOMER_NAME);

    // Use submit button in modal
    await page.locator('form').getByRole('button', { name: 'Создать' }).click();

    // 3. Project Detail Page
    await expect(page.getByRole('heading', { name: PROJECT_NAME })).toBeVisible();

    // 4. Create Calculation
    // Find link or button "Создать расчёт" or "+ Создать расчёт с нуля"
    await page
      .getByRole('link', { name: /Создать расчёт/ })
      .first()
      .click();

    // 5. Presale Wizard
    await expect(page.locator('label').filter({ hasText: 'Название проекта' })).toBeVisible();
    // Step 1 -> 2
    await page.getByRole('button', { name: /Далее/ }).click();
    // Step 2 (Опросник) -> 3
    await expect(page.getByText(/Опросник/).first()).toBeVisible();

    // Fill all required inputs to pass HTML5 validation
    const requiredInputs = page.locator('input[required], select[required], textarea[required]');
    const count = await requiredInputs.count();
    for (let i = 0; i < count; i++) {
      const type = await requiredInputs.nth(i).getAttribute('type');
      const tagName = await requiredInputs.nth(i).evaluate((el) => el.tagName.toLowerCase());

      if (tagName === 'select') {
        // Pick the last option which is usually valid
        const options = requiredInputs.nth(i).locator('option');
        if ((await options.count()) > 1) {
          const val = await options.nth(1).getAttribute('value');
          await requiredInputs.nth(i).selectOption(val!);
        }
      } else if (type === 'number') {
        await requiredInputs.nth(i).fill('1');
      } else {
        await requiredInputs.nth(i).fill('test');
      }
    }

    await page.getByRole('button', { name: /Далее/ }).click();
    // Step 3 (Итог) -> Create
    await expect(page.getByText('Итог: этапы и роли')).toBeVisible();
    await page.getByRole('button', { name: 'Создать расчёт' }).click();

    // 6. Calculation Detail Page
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

    // 9. Back to Project to get Share Link
    await page.goto('/projects');
    await page.getByRole('link', { name: PROJECT_NAME }).first().click();

    // Wait for the project detail page to load
    await expect(page.getByRole('heading', { name: PROJECT_NAME })).toBeVisible();

    // Switch to Packages tab!
    await page.locator('button').filter({ hasText: 'Реестр ГОСТ 34' }).first().click();

    // Архитектор выпустил комплект и потому подписи под ним не ставит: карточка
    // проекта показывает ему только этап, на котором комплект стоит.
    await expect(page.getByText(/на подписи:/i).first()).toBeVisible();
    await expect(page.getByRole('button', { name: '✓ Согласовать' })).toHaveCount(0);

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
  });
});
