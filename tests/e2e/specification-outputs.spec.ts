import { test, expect } from '@playwright/test';
import * as XLSX from 'xlsx';
import { loginAs, createProject, createCalculationViaWizard, E2E_PASSWORD } from './helpers';
import type { SavedSpecification } from '../../lib/specification/types';

test('specification outputs: BOM import, totals, diff, XLSX and released lifecycle', async ({
  page,
}) => {
  test.skip(!E2E_PASSWORD, 'E2E_ARCHITECT_PASSWORD не задан');
  test.setTimeout(180000);
  await loginAs(page, 'architect', E2E_PASSWORD!);
  const name = `SPEC outputs ${Date.now()}`;
  await createProject(page, name, 'Заказчик BOM');
  const id = await createCalculationViaWizard(page);
  const latest = async (version?: number) =>
    (
      await (
        await page.request.get(
          `/api/calculations/${id}/specification${version ? `?version=${version}` : ''}`,
        )
      ).json()
    ).specification as SavedSpecification | null;

  await page.goto(`/calculations/${id}`);
  await page.getByRole('button', { name: 'Спецификация ПАК и ПО', exact: true }).click();

  // BOM import: preview with row errors, only valid selected rows become a new draft.
  await page.getByText('Импорт BOM из XLSX/CSV', { exact: true }).click();
  await page.getByLabel('Файл BOM').setInputFiles({
    name: 'bom.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'Наименование;Артикул;Кол-во;Цена;Валюта;Основание\n' +
        'Сервер;SRV;2;100,5;RUB;Сайзинг\n' +
        'Лицензия;LIC;4;;RUB;Сайзинг\n' +
        ';BAD;1;1;RUB;Без названия\n',
    ),
  });
  await page.getByLabel('Десятичный разделитель').selectOption(',');
  await page.getByRole('button', { name: 'Предпросмотр BOM' }).click();
  await expect(page.getByText(/допустимых: 2 · с ошибками: 1/)).toBeVisible();
  await expect(page.getByLabel('Импортировать строку 4')).toBeDisabled();
  await page.getByRole('button', { name: 'Создать черновик из выбранных строк' }).click();
  await expect.poll(async () => (await latest())?.snapshot.items.length).toBe(2);
  expect((await latest())?.snapshot).toMatchObject({ version: 1, status: 'draft' });

  // Totals are exact per currency; unknown price marks the total incomplete.
  const totals = page.getByTestId('specification-totals');
  await expect(totals).toContainText('201.00 RUB');
  await expect(totals).toContainText('неполная сумма');

  const license = page.getByRole('group', { name: 'Позиция 2', exact: true });
  await license.getByLabel('Цена за единицу (пусто — неизвестно; 0 — бесплатно)').fill('0');
  await license.getByLabel('Причина изменения в этой редакции').fill('Бесплатная лицензия');
  for (const index of [1, 2])
    await page
      .getByRole('group', { name: `Позиция ${index}`, exact: true })
      .getByLabel('Подтверждаю сведения и количество этой позиции')
      .check();
  await page.getByRole('button', { name: 'Подтвердить и сохранить' }).click();
  await expect.poll(async () => (await latest())?.snapshot.status).toBe('confirmed');
  await expect(totals).toContainText('201.00 RUB — 2 поз.');

  // Diff against the imported draft shows the price change and its reason.
  await page.getByLabel('Сравнить с редакцией').fill('1');
  await page.getByRole('button', { name: 'Сравнить', exact: true }).click();
  const diff = page.getByTestId('specification-diff');
  await expect(diff).toContainText('Цена за единицу: неизвестно → 0');
  await expect(diff).toContainText('Причина изменения: Бесплатная лицензия');

  // XLSX of the confirmed revision matches the saved rows.
  const xlsx = await page.request.get(`/api/calculations/${id}/specification/xlsx?version=2`);
  expect(xlsx.status()).toBe(200);
  const wb = XLSX.read(await xlsx.body(), { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['Спецификация'], { header: 1 });
  expect(rows.slice(1).map((r) => r[2])).toEqual(['Сервер', 'Лицензия']);

  // Lifecycle: editors cannot assign released; issuing SPEC releases the pinned revision.
  const confirmed = (await latest())!.snapshot;
  const forged = await page.request.post(`/api/calculations/${id}/specification`, {
    data: { ...confirmed, status: 'released' },
  });
  expect(forged.status()).toBe(400);
  const issued = await page.request.post(`/api/calculations/${id}/gost34`, {
    data: { docType: 'SPEC', specificationVersion: 2 },
  });
  expect(issued.status()).toBe(200);
  await expect.poll(async () => (await latest(2))?.snapshot.status).toBe('released');
  await page.reload();
  await page.getByRole('button', { name: 'Спецификация ПАК и ПО', exact: true }).click();
  await expect(page.getByText(/Редакция выпущена в комплекте ГОСТ 34/)).toBeVisible();
  const review = await page.request.post(`/api/calculations/${id}/specification`, {
    data: { ...confirmed, status: 'review' },
  });
  expect(review.status()).toBe(201);
  expect((await review.json()).snapshot).toMatchObject({ version: 3, status: 'review' });
  expect((await latest(2))?.snapshot.status).toBe('released');
});
