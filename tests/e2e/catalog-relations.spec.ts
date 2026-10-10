import { test, expect } from '@playwright/test';
import { loginAs, createProject, createCalculationViaWizard, E2E_PASSWORD } from './helpers';

test('catalog relations: explicit replacement in a project and a manual row proposed to the catalog', async ({
  page,
}) => {
  test.skip(!E2E_PASSWORD, 'E2E_ARCHITECT_PASSWORD не задан');
  test.setTimeout(120000);
  await loginAs(page, 'architect', E2E_PASSWORD!);
  const name = `Связи ${Date.now()}`;
  const api = async (data: unknown) => {
    const res = await page.request.post('/api/catalog', { data });
    expect(res.status(), await res.text()).toBe(201);
    return res.json();
  };
  const vendor = await api({ action: 'vendor.create', name });
  const product = (sku: string) => ({
    vendorId: vendor.id,
    name: `${name} ${sku}`,
    sku,
    edition: '',
    kind: 'hardware',
    unit: 'шт.',
    licensing: '',
    attributes: [],
  });
  const old = await api({ action: 'product.create', product: product('OLD') });
  const next = await api({ action: 'product.create', product: product('NEW') });
  await api({
    action: 'offer.create',
    id: next.id,
    revision: 1,
    offer: {
      source: 'Прайс',
      unitPrice: '12',
      currency: 'USD',
      region: '',
      terms: '',
      priceDate: null,
      validUntil: null,
    },
  });

  await createProject(page, `${name} Проект`, 'Заказчик');
  const id = await createCalculationViaWizard(page);
  await page.goto(`/calculations/${id}`);
  await page.getByRole('button', { name: 'Спецификация ПАК и ПО', exact: true }).click();
  await page.getByRole('button', { name: 'Загрузить каталог' }).click();
  await page.getByLabel('Каталожная позиция').selectOption(old.id);
  await page.getByRole('button', { name: 'Добавить копию в спецификацию' }).click();
  await page
    .getByRole('group', { name: 'Позиция 1', exact: true })
    .getByLabel('Количество (пусто — неизвестно)')
    .fill('3');
  await page.getByRole('button', { name: 'Добавить позицию', exact: true }).click();
  await page
    .getByRole('group', { name: 'Позиция 2', exact: true })
    .getByLabel('Наименование', { exact: true })
    .fill(`${name} ручная`);
  await page.getByRole('button', { name: 'Сохранить новую редакцию' }).click();
  await expect(page.getByText('Версия 1')).toBeVisible();

  // The catalog withdraws the old product and names its replacement.
  await api({ action: 'product.archive', id: old.id, revision: 1 });
  await api({
    action: 'relation.create',
    relation: { type: 'replaces', fromProductId: next.id, toProductId: old.id, note: 'EOL' },
  });
  await page.getByRole('button', { name: 'Загрузить последнюю' }).click();
  const replacements = page.getByTestId('catalog-replacements');
  await expect(replacements).toContainText('заменено на');
  await replacements.getByLabel('Цена замены').selectOption({ index: 1 });
  page.once('dialog', (dialog) => dialog.accept());
  await replacements.getByRole('button', { name: 'Заменить' }).click();
  await expect(page.getByText('Версия 2')).toBeVisible();
  const row = page.getByRole('group', { name: 'Позиция 1', exact: true });
  await expect(row.getByLabel('Артикул / редакция')).toHaveValue('NEW');
  await expect(row.getByLabel('Количество (пусто — неизвестно)')).toHaveValue('3');
  const v1 = await (
    await page.request.get(`/api/calculations/${id}/specification?version=1`)
  ).json();
  expect(v1.specification.snapshot.items[0].sku).toBe('OLD');

  // A manual row is proposed to the catalog and reviewed in /catalog.
  await page
    .getByRole('group', { name: 'Позиция 2', exact: true })
    .getByRole('button', { name: 'Предложить в каталог' })
    .click();
  await expect(page.getByText('отправлена на рассмотрение')).toBeVisible();
  await page.goto('/catalog');
  const suggestion = page.getByTestId('catalog-suggestion').filter({ hasText: `${name} ручная` });
  await expect(suggestion).toHaveCount(1);
  await suggestion.getByLabel('Комментарий рецензента').fill('Дубль');
  await suggestion.getByRole('button', { name: 'Отклонить' }).click();
  await expect(suggestion).toHaveCount(0);
});
