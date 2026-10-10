import { test, expect } from '@playwright/test';
import { loginAs, E2E_PASSWORD } from './helpers';

test('GPL: map raw CSV, correct an error and import only selected confirmed rows', async ({
  page,
}) => {
  test.skip(!E2E_PASSWORD, 'E2E_ARCHITECT_PASSWORD не задан');
  await loginAs(page, 'architect', E2E_PASSWORD!);
  await page.goto('/catalog');
  const vendor = `GPL ${Date.now()}`;
  await page.getByLabel('Название вендора', { exact: true }).fill(vendor);
  await page.getByRole('button', { name: 'Сохранить вендора', exact: true }).click();
  await expect(
    page.getByLabel('Вендор позиции').getByRole('option', { name: vendor, exact: true }),
  ).toHaveCount(1);
  // Refresh the import panel's vendor list after creating a new vendor.
  await page.reload();
  const panel = page.getByRole('region', { name: 'Импорт вендорского GPL' });
  await panel.getByLabel('Вендор GPL', { exact: true }).selectOption({ label: vendor });
  await panel.getByLabel('Файл GPL (XLSX / CSV)').setInputFiles({
    name: 'vendor.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'Название;Артикул;Цена;Единица\nПринятая позиция;GPL-1;12,50;шт.\nОшибка цены;GPL-2;wrong;шт.\nНе выбранная позиция;GPL-3;0;шт.\n',
    ),
  });
  await panel.getByRole('button', { name: 'Загрузить черновик GPL' }).click();
  await panel.getByLabel('Колонка: Наименование', { exact: true }).selectOption('0');
  await panel.getByLabel('Колонка: Партномер', { exact: true }).selectOption('1');
  await panel.getByLabel('Колонка: Цена', { exact: true }).selectOption('2');
  await panel.getByLabel('Колонка: Единица', { exact: true }).selectOption('3');
  await panel.getByRole('button', { name: 'Применить настройки и проверить строки' }).click();
  await expect(panel.getByLabel('Подтверждаю строку 2', { exact: true })).toBeEnabled();
  await expect(panel.getByLabel('Подтверждаю строку 3', { exact: true })).toBeDisabled();
  await panel.getByRole('button', { name: 'Исправить строку 3', exact: true }).click();
  await panel.getByLabel('Исправленная цена (пусто — неизвестно)').fill('9.25');
  await panel.getByRole('button', { name: 'Сохранить исправление' }).click();
  await expect(panel.getByLabel('Подтверждаю строку 3', { exact: true })).toBeEnabled();
  await panel.getByLabel('Подтверждаю строку 2', { exact: true }).check();
  // New settings require another analysis and explicit selection.
  await panel.getByLabel('Валюта по умолчанию').fill('USD');
  await expect(
    panel.getByRole('button', { name: 'Импортировать подтвержденные строки (1)' }),
  ).toBeDisabled();
  await panel.getByLabel('Валюта по умолчанию').fill('RUB');
  await panel.getByRole('button', { name: 'Импортировать подтвержденные строки (1)' }).click();
  await expect(panel.getByRole('status')).toContainText('1 принято, 2 не выбрано');
  await page.getByRole('button', { name: 'Обновить каталог', exact: true }).click();
  const card = page
    .locator('.card')
    .filter({ has: page.getByRole('heading', { name: `${vendor} · Принятая позиция · GPL-1 ·` }) });
  await card.getByText('История предложений (1)', { exact: true }).click();
  await expect(card.getByText(/12\.50? RUB/)).toBeVisible();
  await expect(card.getByRole('link', { name: 'vendor.csv', exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: new RegExp(`${vendor}.*Не выбранная`) }),
  ).toHaveCount(0);
  await page.reload();
  await panel.getByLabel('Сохраненные пакеты и профили').selectOption({ index: 1 });
  await expect(panel.getByRole('status')).toContainText('1 принято');
  await panel.getByLabel('Редакция пакета GPL').selectOption('1');
  await expect(
    panel.getByText('Историческая редакция: только просмотр.', { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole('button', { name: 'Применить настройки и проверить строки' }),
  ).toHaveCount(0);
  await expect(
    panel.getByRole('button', { name: /Импортировать подтвержденные строки/ }),
  ).toHaveCount(0);
  await expect(panel.getByLabel('Подтверждаю строку 2', { exact: true })).toBeDisabled();
});
