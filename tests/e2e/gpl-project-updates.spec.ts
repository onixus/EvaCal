import { test, expect } from '@playwright/test';
import { loginAs, createProject, createCalculationViaWizard, E2E_PASSWORD } from './helpers';
import type { ImportDraft } from '../../lib/catalog/import-types';
import type { Catalog } from '../../lib/catalog/types';
import type { SavedSpecification } from '../../lib/specification/types';

test('GPL project update: selective draft, manual price preservation and immutable old version', async ({
  page,
}) => {
  test.skip(!E2E_PASSWORD, 'E2E_ARCHITECT_PASSWORD не задан');
  test.setTimeout(120000);
  await loginAs(page, 'architect', E2E_PASSWORD!);
  const name = `GPL project ${Date.now()}`;
  const vendorResponse = await page.request.post('/api/catalog', {
    data: { action: 'vendor.create', name },
  });
  expect(vendorResponse.status()).toBe(201);
  const vendor = await vendorResponse.json();
  async function importPrice(filename: string, price: string) {
    const response = await page.request.post('/api/catalog/imports', {
      multipart: {
        file: {
          name: filename,
          mimeType: 'text/csv',
          buffer: Buffer.from(`Name;SKU;Unit;Price\nProduct;SKU-A;шт.;${price}\n`),
        },
        profile: JSON.stringify({
          vendorId: vendor.id,
          currency: 'RUB',
          decimalSeparator: '.',
          mapping: { name: 0, sku: 1, unit: 2, unitPrice: 3 },
        }),
      },
    });
    expect(response.status()).toBe(201);
    const draft: ImportDraft = await response.json();
    const confirmed = await page.request.post(`/api/catalog/imports/${draft.id}`, {
      data: {
        action: 'confirm',
        revision: draft.revision,
        rowIds: draft.rows.map((row) => row.id),
      },
    });
    expect(confirmed.status()).toBe(200);
    return (await confirmed.json()) as ImportDraft;
  }
  const original = await importPrice('project-before.csv', '10.000001');
  const target = await importPrice('project-after.csv', '20.000002');
  const catalog: Catalog = await (await page.request.get('/api/catalog')).json();
  const product = catalog.products.find((item) => item.vendorId === vendor.id)!;
  const offer = product.offers.find((item) => item.importProvenance?.importId === original.id)!;
  await createProject(page, `${name} Проект`, 'Заказчик GPL');
  const id = await createCalculationViaWizard(page);
  await page.goto(`/calculations/${id}`);
  await page.getByRole('button', { name: 'Спецификация ПАК и ПО', exact: true }).click();
  await page.getByRole('button', { name: 'Загрузить каталог', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Каталожная позиция', exact: true })
    .selectOption(product.id);
  await page
    .getByRole('combobox', { name: 'Ценовое предложение', exact: true })
    .selectOption(offer.id);
  for (let index = 1; index <= 2; index++) {
    await page.getByRole('button', { name: 'Добавить копию в спецификацию' }).click();
    const row = page.getByRole('group', { name: `Позиция ${index}`, exact: true });
    await row.getByLabel('Количество (пусто — неизвестно)').fill(String(index));
    await row.getByLabel('Основание количества / выбора').fill('Проектная потребность');
    if (index === 2)
      await row.getByLabel('Цена за единицу (пусто — неизвестно; 0 — бесплатно)').fill('9');
    await row.getByLabel('Подтверждаю сведения и количество этой позиции').check();
  }
  await page.getByRole('button', { name: 'Добавить позицию', exact: true }).click();
  const manual = page.getByRole('group', { name: 'Позиция 3', exact: true });
  await manual.getByLabel('Наименование', { exact: true }).fill('Ручная услуга');
  await manual.getByRole('combobox', { name: 'Тип', exact: true }).selectOption('service');
  await manual.getByLabel('Количество (пусто — неизвестно)').fill('1');
  await manual.getByLabel('Источник', { exact: true }).fill('Ручная оценка');
  await manual.getByLabel('Основание количества / выбора').fill('Задание');
  await manual.getByLabel('Цена за единицу (пусто — неизвестно; 0 — бесплатно)').fill('5');
  await manual.getByLabel('Подтверждаю сведения и количество этой позиции').check();
  const updates = page.getByRole('region', { name: 'Обновление спецификации из GPL', exact: true });
  await expect(updates.getByRole('button', { name: 'Проверить предложения GPL' })).toBeDisabled();
  await page.getByRole('button', { name: 'Подтвердить и сохранить' }).click();
  await expect(updates.getByRole('button', { name: 'Обновить GPL проекта' })).toBeEnabled();
  const savedResponse = await page.request.get(`/api/calculations/${id}/specification`);
  const before: SavedSpecification = (await savedResponse.json()).specification;
  expect(before.snapshot.items[1].priceOverride).toBe(true);
  await updates
    .getByRole('combobox', { name: 'GPL для обновления проекта', exact: true })
    .selectOption(target.id);
  await updates.getByRole('button', { name: 'Проверить предложения GPL' }).click();
  const firstUpdate = updates.getByRole('group', {
    name: 'Обновление позиции 1: Product',
    exact: true,
  });
  await firstUpdate.getByLabel('Обновить Источник: Product', { exact: true }).uncheck();
  const override = updates.getByRole('group', {
    name: 'Обновление позиции 2: Product',
    exact: true,
  });
  await expect(override.getByLabel('Обновить Цена: Product', { exact: true })).toBeDisabled();
  await override.getByLabel('Разрешаю заменить ручную цену: Product', { exact: true }).check();
  await expect(override.getByLabel('Обновить Цена: Product', { exact: true })).toBeEnabled();
  await override.getByLabel('Разрешаю заменить ручную цену: Product', { exact: true }).uncheck();
  await expect(override.getByLabel('Обновить Цена: Product', { exact: true })).not.toBeChecked();
  await updates.getByRole('button', { name: 'Пересчитать выбранные изменения GPL' }).click();
  await updates.getByRole('button', { name: 'Применить выбранные поля в новую редакцию' }).click();
  await expect(
    page
      .getByRole('group', { name: 'Позиция 1', exact: true })
      .getByLabel('Цена за единицу (пусто — неизвестно; 0 — бесплатно)'),
  ).toHaveValue('20.000002');
  const appliedRow = page.getByRole('group', { name: 'Позиция 1', exact: true });
  await appliedRow.getByText('Источник цены позиции', { exact: true }).click();
  await expect(appliedRow.getByRole('link', { name: target.id, exact: true })).toHaveAttribute(
    'href',
    `/api/catalog/imports/${target.id}/attachment`,
  );
  const after: SavedSpecification = (
    await (await page.request.get(`/api/calculations/${id}/specification`)).json()
  ).specification;
  expect(after.snapshot.status).toBe('draft');
  expect(after.snapshot.items[0].source).toBe(before.snapshot.items[0].source);
  expect(after.snapshot.items[1].unitPrice).toBe('9');
  expect(after.snapshot.items[2]).toEqual(before.snapshot.items[2]);
  const old = (
    await (
      await page.request.get(
        `/api/calculations/${id}/specification?version=${before.snapshot.version}`,
      )
    ).json()
  ).specification;
  expect(old).toEqual(before);
  const stale = await page.request.post(`/api/calculations/${id}/specification/gpl`, {
    data: {
      action: 'apply',
      version: before.snapshot.version,
      targetImportId: target.id,
      targetRevision: target.revision,
      targetChecksum: target.checksum,
      selections: [{ itemId: before.snapshot.items[0].id, fields: ['unitPrice', 'currency'] }],
    },
  });
  expect(stale.status()).toBe(409);
  await page
    .getByRole('group', { name: 'Позиция 1', exact: true })
    .getByLabel('Наименование', { exact: true })
    .fill('Несохраненное изменение');
  await expect(updates.getByRole('button', { name: 'Проверить предложения GPL' })).toBeDisabled();
});
