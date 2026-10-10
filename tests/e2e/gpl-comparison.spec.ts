import { test, expect } from '@playwright/test';
import { loginAs, E2E_PASSWORD } from './helpers';
import type { ImportDraft } from '../../lib/catalog/import-types';

test('GPL comparison: confirmed rows, exact prices and incomplete coverage preserve history', async ({
  page,
}) => {
  test.skip(!E2E_PASSWORD, 'E2E_ARCHITECT_PASSWORD не задан');
  await loginAs(page, 'architect', E2E_PASSWORD!);
  const name = `GPL comparison ${Date.now()}`;
  const vendorResponse = await page.request.post('/api/catalog', {
    data: { action: 'vendor.create', name },
  });
  expect(vendorResponse.status()).toBe(201);
  const vendor = await vendorResponse.json();
  async function upload(filename: string, csv: string, selected: string[]) {
    const response = await page.request.post('/api/catalog/imports', {
      multipart: {
        file: { name: filename, mimeType: 'text/csv', buffer: Buffer.from(csv) },
        profile: JSON.stringify({
          vendorId: vendor.id,
          delimiter: ';',
          decimalSeparator: '.',
          currency: 'RUB',
          mapping: { name: 0, sku: 1, unit: 2, unitPrice: 3, currency: 4, terms: 5 },
        }),
      },
    });
    expect(response.status()).toBe(201);
    const draft: ImportDraft = await response.json();
    const confirm = await page.request.post(`/api/catalog/imports/${draft.id}`, {
      data: {
        action: 'confirm',
        revision: draft.revision,
        rowIds: draft.rows
          .filter((row) => selected.includes(row.normalized?.product.sku || ''))
          .map((row) => row.id),
      },
    });
    expect(confirm.status()).toBe(200);
    return (await confirm.json()) as ImportDraft;
  }
  const before = await upload(
    'before.csv',
    'Название;SKU;Ед;Цена;Валюта;Условия\nA;A;шт;10.000001;USD;Старая цена\nB;B;шт;0;RUB;\nExcluded;X;шт;1;RUB;\n',
    ['A', 'B'],
  );
  const after = await upload(
    'after.csv',
    'Название;SKU;Ед;Цена;Валюта;Условия\nA;A;шт;20.000002;USD;Новая цена\nC;C;шт;0;RUB;\nExcluded;Y;шт;2;RUB;\nError;E;шт;wrong;RUB;\n',
    ['A', 'C'],
  );
  await page.goto('/catalog');
  const panel = page.getByRole('region', { name: 'Сравнение вендорских GPL', exact: true });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Обновить список GPL' })).toBeEnabled();
  await panel
    .getByRole('combobox', { name: 'Вендор для сравнения', exact: true })
    .selectOption(vendor.id);
  await panel.getByRole('combobox', { name: 'Исходный GPL', exact: true }).selectOption(before.id);
  await panel.getByRole('combobox', { name: 'Следующий GPL', exact: true }).selectOption(after.id);
  await panel.getByRole('button', { name: 'Сравнить выбранные GPL' }).click();
  await expect(panel.getByRole('status')).toContainText('Покрытие неполное');
  const changed = panel
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: 'A · редакция не задана', exact: true }) });
  await expect(changed).toContainText('Цена: 10.000001 USD');
  await expect(changed).toContainText('Цена: 20.000002 USD');
  await expect(changed).toContainText('Старая цена → Новая цена');
  const missing = panel
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: 'B · редакция не задана', exact: true }) });
  await expect(missing).toContainText('Нет среди подтвержденных строк');
  const added = panel
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: 'C · редакция не задана', exact: true }) });
  await expect(added).toContainText('Добавлены');
  await expect(
    panel
      .getByRole('row')
      .filter({ has: page.getByRole('cell', { name: /^[XYE] · редакция не задана$/ }) }),
  ).toHaveCount(0);
  await panel
    .getByRole('combobox', { name: 'Статус сравнения', exact: true })
    .selectOption('missing');
  await expect(panel.getByRole('row')).toHaveCount(2);
  expect(await (await page.request.get(`/api/catalog/imports/${before.id}`)).json()).toEqual(
    before,
  );
  expect(await (await page.request.get(`/api/catalog/imports/${after.id}`)).json()).toEqual(after);
  // A retained malformed historical snapshot must stay inspectable in the UI.
  const malformed = await (
    await page.request.get(`/api/catalog/imports/compare?before=${before.id}&after=${after.id}`)
  ).json();
  const malformedRow = malformed.rows.find((row: { sku: string }) => row.sku === 'A');
  malformedRow.before[0].normalized = {};
  malformedRow.status = 'ambiguous';
  malformed.counts.changed--;
  malformed.counts.ambiguous++;
  await page.route('**/api/catalog/imports/compare?*', (route) =>
    route.fulfill({ json: malformed }),
  );
  await panel
    .getByRole('combobox', { name: 'Статус сравнения', exact: true })
    .selectOption('ambiguous');
  await panel.getByRole('button', { name: 'Сравнить выбранные GPL' }).click();
  await expect(panel.getByText('Сведения позиции отсутствуют', { exact: true })).toBeVisible();
  await panel.getByLabel('Поиск в сравнении', { exact: true }).fill('A');
  await expect(panel.getByRole('link', { name: 'before.csv', exact: true })).toBeVisible();
  await panel.getByRole('combobox', { name: 'Следующий GPL', exact: true }).selectOption('');
  await expect(panel.getByRole('table')).toHaveCount(0);
});

test('GPL comparison history: append older sources once and refresh first page', async ({
  page,
}) => {
  test.skip(!E2E_PASSWORD, 'E2E_ARCHITECT_PASSWORD не задан');
  await loginAs(page, 'architect', E2E_PASSWORD!);
  const vendor = { id: 'paged-vendor', name: 'Проверка страниц GPL', archived: false, revision: 1 };
  const source = (id: string) => ({
    id,
    vendorId: vendor.id,
    status: 'confirmed',
    filename: `${id}.csv`,
    checksum: id,
    revision: 2,
    createdAt: '2026-10-10T00:00:00Z',
  });
  const firstPage = Array.from({ length: 100 }, (_, i) => source(`gpl-${i}`));
  const cursors: string[] = [];
  await page.route('**/api/catalog', (route) =>
    route.fulfill({ json: { vendors: [vendor], products: [] } }),
  );
  await page.route(/\/api\/catalog\/imports(?:\?|$)/, (route) => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor');
    if (cursor) cursors.push(cursor);
    return route.fulfill({ json: cursor ? [firstPage[99], source('older')] : firstPage });
  });
  await page.goto('/catalog');
  const panel = page.getByRole('region', { name: 'Сравнение вендорских GPL', exact: true });
  await panel
    .getByRole('combobox', { name: 'Вендор для сравнения', exact: true })
    .selectOption(vendor.id);
  await panel.getByRole('button', { name: 'Загрузить более ранние GPL' }).click();
  const choice = panel.getByRole('combobox', { name: 'Исходный GPL', exact: true });
  await expect(choice.getByRole('option')).toHaveCount(102);
  expect(cursors).toEqual(['gpl-99']);
  await expect(panel.getByRole('button', { name: 'Загрузить более ранние GPL' })).toHaveCount(0);
  await choice.selectOption('older');
  await panel.getByRole('button', { name: 'Обновить список GPL' }).click();
  await expect(choice).toHaveValue('');
  await expect(choice.getByRole('option')).toHaveCount(101);
});
