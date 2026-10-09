import { test, expect } from '@playwright/test';
import { loginAs, createProject, createCalculationViaWizard, E2E_PASSWORD } from './helpers';

test('commercial pricing: explicit mode persists and copied version retains financial rules', async ({
  page,
}) => {
  test.skip(!E2E_PASSWORD, 'E2E_ARCHITECT_PASSWORD не задан');
  test.setTimeout(90000);
  await loginAs(page, 'architect', E2E_PASSWORD!);
  await createProject(page, `КП ${Date.now()}`, 'Заказчик КП');
  const id = await createCalculationViaWizard(page);
  await page.goto(`/calculations/${id}`);
  await page.getByRole('button', { name: 'Смета и КП' }).click();
  await expect(page.getByLabel('Режим расчета цены')).toHaveValue('legacy_markup');
  await page.getByLabel('Режим расчета цены').selectOption('target_margin');
  await page.getByLabel('Процент цены').fill('20');
  await page.getByLabel('Скидка заказчику').press('Home');
  for (let i = 0; i < 10; i++) await page.getByLabel('Скидка заказчику').press('ArrowRight');
  await expect(page.getByText('11.11%', { exact: true })).toBeVisible();
  await expect(page.getByText('Цена до скидки = себестоимость /', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: /Сохранить/ }).click();
  await expect
    .poll(
      async () => (await (await page.request.get(`/api/calculations/${id}`)).json()).pricingMode,
    )
    .toBe('target_margin');
  await page.reload();
  await page.getByRole('button', { name: 'Смета и КП' }).click();
  await expect(page.getByLabel('Режим расчета цены')).toHaveValue('target_margin');
  await expect(page.getByText('Прибыль после скидки', { exact: true })).toBeVisible();
  const invalid = await page.request.patch(`/api/calculations/${id}`, {
    data: { pricingMode: 'target_margin', marginPercent: 100 },
  });
  expect(invalid.status()).toBe(400);
  expect((await (await page.request.get(`/api/calculations/${id}`)).json()).marginPercent).toBe(20);
  const version = await page.request.post(`/api/calculations/${id}/version`, { data: {} });
  expect(version.status()).toBe(201);
  const cloneId = (await version.json()).id;
  const clone = await page.request.get(`/api/calculations/${cloneId}`);
  expect((await clone.json()).pricingMode).toBe('target_margin');
});
