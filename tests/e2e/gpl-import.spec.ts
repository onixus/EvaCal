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
  const panel = page.getByRole('region', { name: 'Импорт вендорского GPL', exact: true });
  await expect(panel).toBeVisible();
  await panel
    .getByRole('combobox', { name: 'Вендор GPL', exact: true })
    .selectOption({ label: vendor });
  await panel.getByLabel('Файл GPL (XLSX / CSV)').setInputFiles({
    name: 'vendor.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'Название;Артикул;Цена;Единица\nПринятая позиция;GPL-1;12,50;шт.\nОшибка цены;GPL-2;wrong;шт.\nНе выбранная позиция;GPL-3;0;шт.\n',
    ),
  });
  await panel.getByRole('button', { name: 'Загрузить черновик GPL' }).click();
  await panel
    .getByRole('combobox', { name: 'Колонка: Наименование', exact: true })
    .selectOption('0');
  await panel.getByRole('combobox', { name: 'Колонка: Партномер', exact: true }).selectOption('1');
  await panel.getByRole('combobox', { name: 'Колонка: Цена', exact: true }).selectOption('2');
  await panel.getByRole('combobox', { name: 'Колонка: Единица', exact: true }).selectOption('3');
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
  await panel
    .getByRole('combobox', { name: 'Сохраненные пакеты и профили', exact: true })
    .selectOption({ index: 1 });
  await expect(panel.getByRole('status')).toContainText('1 принято');
  await panel.getByRole('combobox', { name: 'Редакция пакета GPL', exact: true }).selectOption('1');
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

test('GPL: saved import profile is reused on a file with reordered columns', async ({ page }) => {
  test.skip(!E2E_PASSWORD, 'E2E_ARCHITECT_PASSWORD не задан');
  await loginAs(page, 'architect', E2E_PASSWORD!);
  await page.goto('/catalog');
  const vendor = `GPL profile ${Date.now()}`;
  await page.getByLabel('Название вендора', { exact: true }).fill(vendor);
  await page.getByRole('button', { name: 'Сохранить вендора', exact: true }).click();
  await expect(
    page.getByLabel('Вендор позиции').getByRole('option', { name: vendor, exact: true }),
  ).toHaveCount(1);
  await page.reload();
  const panel = page.getByRole('region', { name: 'Импорт вендорского GPL', exact: true });
  await panel
    .getByRole('combobox', { name: 'Вендор GPL', exact: true })
    .selectOption({ label: vendor });
  await panel.getByLabel('Файл GPL (XLSX / CSV)').setInputFiles({
    name: 'first.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'Название;Артикул;Цена;Единица;Дата прайса;НДС\nСервер;PRF-1;10,5;шт.;01.10.2026;20%\n',
    ),
  });
  await panel.getByRole('button', { name: 'Загрузить черновик GPL' }).click();
  for (const [label, column] of [
    ['Наименование', '0'],
    ['Партномер', '1'],
    ['Цена', '2'],
    ['Единица', '3'],
    ['Дата цены', '4'],
    ['НДС, %', '5'],
  ])
    await panel
      .getByRole('combobox', { name: `Колонка: ${label}`, exact: true })
      .selectOption(column);
  await panel.getByRole('button', { name: 'Применить настройки и проверить строки' }).click();
  await expect(panel.getByLabel('Подтверждаю строку 2', { exact: true })).toBeEnabled();
  await expect(panel.getByText(/Дата цены 2026-10-01/)).toBeVisible();
  await panel.getByLabel('Название профиля', { exact: true }).fill('E2E профиль');
  await panel.getByRole('button', { name: 'Сохранить как новый профиль' }).click();
  await expect(panel.getByRole('combobox', { name: 'Профиль импорта', exact: true })).toHaveValue(
    /.+/,
  );
  // Second file: columns reordered, the tax column renamed, a new region column.
  await panel.getByLabel('Файл GPL (XLSX / CSV)').setInputFiles({
    name: 'second.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'Единица;Цена;Артикул;Регион;Название;Дата прайса;Ставка\nшт.;12;PRF-2;RU;Сервер 2;02.10.2026;20\n',
    ),
  });
  await panel.getByRole('button', { name: 'Загрузить черновик GPL' }).click();
  const report = panel.getByRole('group', { name: 'Применение профиля' });
  await expect(report).toContainText('Применен профиль «E2E профиль»');
  await expect(report).toContainText('Расхождение: НДС, %: колонка «НДС» не найдена в файле');
  await expect(report).toContainText('Новые колонки файла: Регион, Ставка');
  await expect(panel.getByRole('combobox', { name: 'Колонка: Цена', exact: true })).toHaveValue(
    '1',
  );
  await expect(panel.getByLabel('Подтверждаю строку 2', { exact: true })).toBeEnabled();
  await expect(panel.getByText(/Дата цены 2026-10-02/)).toBeVisible();
  await expect(panel.getByText(/НДС неизвестен/)).toBeVisible();
});
