import { test, expect } from '@playwright/test';
import { loginAs, createProject, createCalculationViaWizard, E2E_PASSWORD } from './helpers';
test('catalog: new vendor, attributes, price history and mixed immutable project copy', async ({
  page,
}) => {
  test.skip(!E2E_PASSWORD, 'E2E_ARCHITECT_PASSWORD не задан');
  test.setTimeout(120000);
  await loginAs(page, 'architect', E2E_PASSWORD!);
  const name = `Каталог ${Date.now()}`;
  await page.goto('/catalog');
  await page.getByLabel('Название вендора', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Сохранить вендора', exact: true }).click();
  await expect(
    page.getByLabel('Вендор позиции').getByRole('option', { name, exact: true }),
  ).toHaveCount(1);
  await page.getByLabel('Вендор позиции').selectOption({ label: name });
  await page.getByLabel('Наименование', { exact: true }).fill(`${name} Товар`);
  await page.getByLabel('Партномер', { exact: true }).fill('SKU-1');
  await page.getByRole('button', { name: 'Добавить характеристику' }).click();
  await page.getByLabel('Название характеристики 1', { exact: true }).fill('CPU');
  await page.getByLabel('Значение характеристики 1', { exact: true }).fill('4');
  await page.getByLabel('Единица характеристики 1', { exact: true }).fill('ядра');
  await page.getByRole('button', { name: 'Сохранить позицию', exact: true }).click();
  const productOption = page
    .getByLabel('Позиция для цены')
    .getByRole('option', { name: new RegExp(name) });
  await expect(productOption).toHaveCount(1);
  const catalogProductId = (await productOption.getAttribute('value'))!;
  await page.getByLabel('Позиция для цены').selectOption(catalogProductId);
  await page.getByLabel('Источник цены', { exact: true }).fill('Ручной источник');
  await page.getByLabel('Цена за единицу: пусто — неизвестно').fill('123.000001');
  await page.getByRole('button', { name: 'Сохранить отдельное предложение' }).click();
  await expect(page.getByText('История предложений (1)', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('CPU: 4 ядра', { exact: true })).toBeVisible();
  await createProject(page, `${name} Проект`, 'Заказчик каталога');
  const id = await createCalculationViaWizard(page);
  await page.goto(`/calculations/${id}`);
  await page.getByRole('button', { name: 'Спецификация ПАК и ПО', exact: true }).click();
  await page.getByRole('button', { name: 'Загрузить каталог' }).click();
  await page.getByLabel('Каталожная позиция').selectOption(catalogProductId);
  await page.getByLabel('Ценовое предложение').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Добавить копию в спецификацию' }).click();
  const row = page.getByRole('group', { name: 'Позиция 1', exact: true });
  await expect(row.getByLabel('Наименование', { exact: true })).toHaveValue(`${name} Товар`);
  await expect(row.getByLabel('Характеристики', { exact: true })).toHaveValue('CPU: 4 ядра');
  await expect(row.getByLabel('Цена за единицу (пусто — неизвестно; 0 — бесплатно)')).toHaveValue(
    '123.000001',
  );
  await row.getByLabel('Количество (пусто — неизвестно)').fill('2');
  await row.getByLabel('Основание количества / выбора').fill('Проектная потребность');
  await row.getByLabel('Подтверждаю сведения и количество этой позиции').check();
  await page.getByRole('button', { name: 'Добавить позицию', exact: true }).click();
  const manual = page.getByRole('group', { name: 'Позиция 2', exact: true });
  await manual.getByLabel('Наименование', { exact: true }).fill('Ручная услуга');
  await manual.getByLabel('Тип', { exact: true }).selectOption('service');
  await manual.getByLabel('Количество (пусто — неизвестно)').fill('1');
  await manual.getByLabel('Источник', { exact: true }).fill('Ручная оценка');
  await manual.getByLabel('Основание количества / выбора').fill('Задание заказчика');
  await manual.getByLabel('Цена за единицу (пусто — неизвестно; 0 — бесплатно)').fill('0');
  await manual.getByLabel('Подтверждаю сведения и количество этой позиции').check();
  await page.getByRole('button', { name: 'Подтвердить и сохранить' }).click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/calculations/${id}/specification`)).json())
          .specification?.snapshot.status,
    )
    .toBe('confirmed');
  const before = (
    await (await page.request.get(`/api/calculations/${id}/specification?version=1`)).json()
  ).specification.snapshot;
  const catalog = await (await page.request.get('/api/catalog')).json();
  const product = catalog.products.find((p: { name: string }) => p.name === `${name} Товар`);
  const changed = await page.request.post('/api/catalog', {
    data: {
      action: 'product.update',
      id: product.id,
      revision: product.revision,
      product: { ...product, name: 'Новая редакция', sku: 'SKU-2' },
    },
  });
  expect(changed.status()).toBe(201);
  const after = (
    await (await page.request.get(`/api/calculations/${id}/specification?version=1`)).json()
  ).specification.snapshot;
  expect(after).toEqual(before);
  await page.reload();
  await page.getByRole('button', { name: 'Спецификация ПАК и ПО', exact: true }).click();
  await expect(
    page
      .getByRole('group', { name: 'Позиция 1', exact: true })
      .getByLabel('Наименование', { exact: true }),
  ).toHaveValue(`${name} Товар`);
});
