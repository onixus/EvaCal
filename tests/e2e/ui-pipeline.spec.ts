import { test, expect } from '@playwright/test';
import { createCalculationViaWizard, createProject, E2E_PASSWORD, loginAs } from './helpers';

/**
 * Новый UI: рабочий стол, конвейер проекта, фильтры в URL и доска заявок.
 * Сценарий самодостаточен — заводит свой проект, чтобы не зависеть от
 * порядка запуска с выпуском «Северного банка».
 */
test.describe('UI: конвейер проекта, фильтры и доска заявок', () => {
  test.setTimeout(240000);
  const STAMP = Date.now().toString(36);
  const PROJECT_NAME = `Единое окно (e2e ${STAMP})`;
  const CUSTOMER_NAME = `АО «Регион ${STAMP}»`;

  test('рабочий стол → проект → смета на утверждение → доска → утверждение', async ({ page }) => {
    test.skip(!E2E_PASSWORD, 'E2E_ARCHITECT_PASSWORD не задан');
    const password = E2E_PASSWORD as string;

    // Пресейл: рабочий стол, проект и черновик сметы.
    await loginAs(page, 'presale', password);
    await expect(page.getByRole('heading', { level: 1, name: 'Рабочий стол' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Конвейер проектов' })).toBeVisible();

    await createProject(page, PROJECT_NAME, CUSTOMER_NAME);
    const stepper = page.getByRole('list', { name: 'Этапы проекта' });
    await expect(stepper.locator('[aria-current="step"]')).toContainText('Расчёт');

    const calculationId = await createCalculationViaWizard(page);

    // Отправляем смету на согласование — так же, как кнопка редактора пресейла.
    const submit = await page.request.post(`/api/calculations/${calculationId}/submit`);
    expect(submit.ok()).toBeTruthy();

    // Реестр проектов: фильтр по этапу живёт в URL и применяется сразу.
    await page.goto('/projects');
    await page
      .getByRole('group', { name: 'Этап конвейера' })
      .getByRole('button', {
        name: 'Согласование',
      })
      .click();
    await expect(page).toHaveURL(/stage=estimate_review/);
    const row = page.locator('table tbody tr').filter({ hasText: PROJECT_NAME });
    await expect(row).toBeVisible();
    await expect(row).toContainText('Согласование');
    await expect(row.getByRole('link', { name: 'Утвердить смету' })).toBeVisible();

    // Поиск: параметр появляется в адресе без кнопки «Найти», список сужается.
    await page.getByRole('searchbox').fill(STAMP);
    await expect(page).toHaveURL(new RegExp(`search=${STAMP}`));
    await expect(page.locator('table tbody tr')).toHaveCount(1);

    // Карточка проекта: конвейер на «Согласование», следующее действие — утвердить.
    await row.getByRole('link', { name: PROJECT_NAME }).click();
    await expect(page.getByRole('heading', { name: PROJECT_NAME })).toBeVisible();
    await expect(stepper.locator('[aria-current="step"]')).toContainText('Согласование');
    await expect(page.getByTestId('lifecycle-next')).toHaveText(/Утвердить смету/);

    // Архитектор: очередь на рабочем столе и утверждение перетаскиванием на доске.
    await loginAs(page, 'architect', password);
    await expect(
      page.getByRole('link', { name: new RegExp(`Утвердить смету: .*${STAMP}`) }),
    ).toBeVisible();

    await page.goto('/board');
    const pending = page.getByRole('region', { name: 'На утверждении' });
    const approved = page.getByRole('region', { name: 'Смета утверждена' });
    const card = pending.locator('article').filter({ hasText: CUSTOMER_NAME });
    await expect(card).toBeVisible();

    await card.dragTo(approved);
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Утвердить смету' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Утвердить' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 15000 });
    await expect(approved.locator('article').filter({ hasText: CUSTOMER_NAME })).toBeVisible({
      timeout: 15000,
    });
    await expect(pending.locator('article').filter({ hasText: CUSTOMER_NAME })).toHaveCount(0);

    // Конвейер проекта сдвинулся на «Утверждена», дальше — Студия ГОСТ 34.
    await page.goto('/projects?search=' + encodeURIComponent(STAMP));
    await page.getByRole('link', { name: PROJECT_NAME }).first().click();
    await expect(stepper.locator('[aria-current="step"]')).toContainText('Утверждена');
    await expect(page.getByTestId('lifecycle-next')).toHaveText(/Студию/);

    // Архив расчётов: фильтр по статусу — чипами, смета видна среди утверждённых.
    await page.goto('/calculations');
    await page.getByRole('button', { name: /^Утверждённые/ }).click();
    await expect(page).toHaveURL(/status=approved/);
    await expect(page.locator('table tbody tr').filter({ hasText: CUSTOMER_NAME })).toBeVisible();
  });
});
