/**
 * Сквозная приемка issue #101 («Сквозная приемка уточненного сценария» и связанные
 * критерии): вендор и GPL через UI, спецификация из двух прайсов и ручной строки,
 * следующий GPL с новой ценой, замененным партномером и исчезнувшей позицией,
 * выборочное обновление с сохранением ручных цен, сайзинг (новая версия профиля и
 * новые входы) с предпросмотром влияния, полностью ручной состав и согласованность
 * UI / КП / SPEC DOCX / SPEC.xlsx / ZIP (курс из снимка, округление, неизвестная цена,
 * бесплатная позиция). Медленные подготовительные шаги идут через API, проверки
 * пользовательских шагов — через UI.
 */
import { test, expect, type Page } from '@playwright/test';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { loginAs, createProject, createCalculationViaWizard, E2E_PASSWORD } from './helpers';
import type { ImportDraft } from '../../lib/catalog/import-types';
import type { Catalog, Product } from '../../lib/catalog/types';
import type { SavedSpecification, SpecificationSnapshot } from '../../lib/specification/types';

const PRICE = 'Цена за единицу (пусто — неизвестно; 0 — бесплатно)';
const QTY = 'Количество (пусто — неизвестно)';
const RATIONALE = 'Основание количества / выбора';
const CONFIRM_ROW = 'Подтверждаю сведения и количество этой позиции';

async function spec(page: Page, id: string, version?: number) {
  const res = await page.request.get(
    `/api/calculations/${id}/specification${version ? `?version=${version}` : ''}`,
  );
  expect(res.status()).toBe(200);
  return (await res.json()).specification as SavedSpecification;
}
/** Latest revision or null before the first save (for polling). */
async function maybeSpec(page: Page, id: string, version?: number) {
  const res = await page.request.get(
    `/api/calculations/${id}/specification${version ? `?version=${version}` : ''}`,
  );
  return res.ok() ? ((await res.json()).specification as SavedSpecification | null) : null;
}

async function catalog(page: Page): Promise<Catalog> {
  return (await page.request.get('/api/catalog')).json();
}

async function catalogAction(page: Page, data: unknown) {
  const res = await page.request.post('/api/catalog', { data });
  expect(res.status(), await res.text()).toBe(201);
  return res.json();
}

/** GPL через API: черновик → подтверждение всех допустимых строк. */
async function importGpl(page: Page, vendorId: string, filename: string, csv: string) {
  const res = await page.request.post('/api/catalog/imports', {
    multipart: {
      file: { name: filename, mimeType: 'text/csv', buffer: Buffer.from(csv) },
      profile: JSON.stringify({
        vendorId,
        currency: 'RUB',
        decimalSeparator: '.',
        mapping: { name: 0, sku: 1, unit: 2, unitPrice: 3 },
      }),
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const draft: ImportDraft = await res.json();
  const confirmed = await page.request.post(`/api/catalog/imports/${draft.id}`, {
    data: {
      action: 'confirm',
      revision: draft.revision,
      rowIds: draft.rows.filter((r) => !r.errors.length).map((r) => r.id),
    },
  });
  expect(confirmed.status(), await confirmed.text()).toBe(200);
  return (await confirmed.json()) as ImportDraft;
}

async function openSpecification(page: Page, id: string) {
  await page.goto(`/calculations/${id}`);
  await page.getByRole('button', { name: 'Спецификация ПАК и ПО', exact: true }).click();
  await expect(page.getByTestId('specification-totals')).toBeVisible();
}

const row = (page: Page, n: number) =>
  page.getByRole('group', { name: `Позиция ${n}`, exact: true });

/** Копия каталожной позиции с выбранным предложением (GPL), количество и подтверждение. */
async function addFromCatalog(
  page: Page,
  product: Product,
  offerId: string,
  n: number,
  qty: string,
) {
  await page
    .getByRole('combobox', { name: 'Каталожная позиция', exact: true })
    .selectOption(product.id);
  await page
    .getByRole('combobox', { name: 'Ценовое предложение', exact: true })
    .selectOption(offerId);
  await page.getByRole('button', { name: 'Добавить копию в спецификацию' }).click();
  await expect(row(page, n).getByLabel('Наименование', { exact: true })).toHaveValue(product.name);
  await row(page, n).getByLabel(QTY).fill(qty);
  await row(page, n).getByLabel(RATIONALE).fill('Проектная потребность');
  await row(page, n).getByLabel(CONFIRM_ROW).check();
}

test.describe('Issue #101: сквозная приемка', () => {
  test.skip(!E2E_PASSWORD, 'E2E_ARCHITECT_PASSWORD не задан');

  test('вендор и GPL через UI, спецификация из двух GPL и ручной строки, следующий GPL, выборочное обновление и замена', async ({
    page,
  }) => {
    test.setTimeout(300000);
    await loginAs(page, 'architect', E2E_PASSWORD!);
    const stamp = Date.now();
    const vendorA = `Вендор A ${stamp}`;

    // (1) Новый вендор через UI и его GPL: сопоставление колонок, неоднозначная строка
    // (повтор партномера) исправляется до подтверждения; результат сохраняется в БД.
    await page.goto('/catalog');
    await page.getByLabel('Название вендора', { exact: true }).fill(vendorA);
    await page.getByRole('button', { name: 'Сохранить вендора', exact: true }).click();
    await expect(
      page.getByLabel('Вендор позиции').getByRole('option', { name: vendorA, exact: true }),
    ).toHaveCount(1);
    await page.reload();
    const panel = page.getByRole('region', { name: 'Импорт вендорского GPL', exact: true });
    await panel
      .getByRole('combobox', { name: 'Вендор GPL', exact: true })
      .selectOption({ label: vendorA });
    await panel.getByLabel('Файл GPL (XLSX / CSV)').setInputFiles({
      name: 'vendor-a-v1.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'Название;Артикул;Единица;Цена\n' +
          'Сервер A;A-SRV;шт.;100,50\n' +
          'Лицензия A;A-LIC;шт.;20\n' +
          'Лицензия A расширенная;A-LIC;шт.;25\n' +
          'Снимаемая позиция;A-OLD;шт.;5\n',
      ),
    });
    await panel.getByRole('button', { name: 'Загрузить черновик GPL' }).click();
    for (const [label, column] of [
      ['Наименование', '0'],
      ['Партномер', '1'],
      ['Единица', '2'],
      ['Цена', '3'],
    ])
      await panel
        .getByRole('combobox', { name: `Колонка: ${label}`, exact: true })
        .selectOption(column);
    await panel.getByRole('button', { name: 'Применить настройки и проверить строки' }).click();
    await expect(panel.getByText(/Дублирующийся артикул/).first()).toBeVisible();
    await expect(panel.getByLabel('Подтверждаю строку 4', { exact: true })).toBeDisabled();
    await panel.getByRole('button', { name: 'Исправить строку 4', exact: true }).click();
    await panel.getByLabel('Исправленный партномер').fill('A-LIC-EXT');
    await panel.getByRole('button', { name: 'Сохранить исправление' }).click();
    for (const n of [2, 3, 4, 5]) {
      await expect(panel.getByLabel(`Подтверждаю строку ${n}`, { exact: true })).toBeEnabled();
      await panel.getByLabel(`Подтверждаю строку ${n}`, { exact: true }).check();
    }
    await panel.getByRole('button', { name: 'Импортировать подтвержденные строки (4)' }).click();
    await expect(panel.getByRole('status')).toContainText('4 принято');
    // Сохранено в БД: после перезагрузки позиции и исходный файл доступны в каталоге.
    await page.reload();
    const extCard = page.locator('.card').filter({
      has: page.getByRole('heading', { name: `${vendorA} · Лицензия A расширенная · A-LIC-EXT ·` }),
    });
    await extCard.getByText('История предложений (1)', { exact: true }).click();
    await expect(extCard.getByRole('link', { name: 'vendor-a-v1.csv', exact: true })).toBeVisible();

    // Второй вендор и его GPL (подготовка через API).
    const vendorB = await catalogAction(page, {
      action: 'vendor.create',
      name: `Вендор B ${stamp}`,
    });
    await importGpl(
      page,
      vendorB.id,
      'vendor-b.csv',
      'Name;SKU;Unit;Price\nКоммутатор B;B-NET;шт.;7\n',
    );

    const cat = await catalog(page);
    const byVendor = (vendorId: string, sku: string) =>
      cat.products.find((p) => p.vendorId === vendorId && p.sku === sku)!;
    const vendorAId = cat.vendors.find((v) => v.name === vendorA)!.id;
    const [srv, lic, ext, old, net] = [
      byVendor(vendorAId, 'A-SRV'),
      byVendor(vendorAId, 'A-LIC'),
      byVendor(vendorAId, 'A-LIC-EXT'),
      byVendor(vendorAId, 'A-OLD'),
      byVendor(vendorB.id, 'B-NET'),
    ];
    const offer = (p: Product) => p.offers.find((o) => o.importProvenance)!.id;

    // (2) Одна спецификация из двух вендорских прайсов и полностью ручной строки с ручной ценой.
    await createProject(page, `Приемка 101 ${stamp}`, 'Заказчик приемки');
    const id = await createCalculationViaWizard(page);
    await openSpecification(page, id);
    await page.getByRole('button', { name: 'Загрузить каталог', exact: true }).click();
    await addFromCatalog(page, srv, offer(srv), 1, '2');
    await addFromCatalog(page, lic, offer(lic), 2, '3');
    await addFromCatalog(page, ext, offer(ext), 3, '1');
    // Ручная цена в каталожной строке — проектное решение, не меняет каталог.
    await row(page, 3).getByLabel(PRICE).fill('22');
    await row(page, 3).getByLabel(CONFIRM_ROW).check();
    await addFromCatalog(page, old, offer(old), 4, '4');
    await addFromCatalog(page, net, offer(net), 5, '5');
    await page.getByRole('button', { name: 'Добавить позицию', exact: true }).click();
    const manual = row(page, 6);
    await manual.getByLabel('Наименование', { exact: true }).fill('Ручные работы по монтажу');
    await manual.getByRole('combobox', { name: 'Тип', exact: true }).selectOption('service');
    await manual.getByLabel(QTY).fill('1');
    await manual.getByLabel('Источник', { exact: true }).fill('Оценка инженера');
    await manual.getByLabel(RATIONALE).fill('Задание заказчика');
    await manual.getByLabel(PRICE).fill('1500');
    await manual.getByLabel(CONFIRM_ROW).check();
    await page.getByRole('button', { name: 'Подтвердить и сохранить' }).click();
    await expect.poll(async () => (await maybeSpec(page, id))?.snapshot.status).toBe('confirmed');
    const v1 = await spec(page, id);
    // 2×100.5 + 3×20 + 22 + 4×5 + 5×7 + 1500 = 1838
    const totals = page.getByTestId('specification-totals');
    await expect(totals).toContainText('1838.00 RUB — 6 поз.');
    // Повторное открытие: состав, количества и цены без потерь.
    await openSpecification(page, id);
    await expect(row(page, 3).getByLabel(PRICE)).toHaveValue('22');
    await expect(row(page, 5).getByLabel('Вендор', { exact: true })).toHaveValue(
      `Вендор B ${stamp}`,
    );
    await expect(row(page, 6).getByLabel(PRICE)).toHaveValue('1500');
    await expect(totals).toContainText('1838.00 RUB — 6 поз.');
    expect((await spec(page, id)).snapshot.items).toEqual(v1.snapshot.items);
    // Выпуск комплекта SPEC закрепляет редакцию как выпущенную.
    const issued = await page.request.post(`/api/calculations/${id}/gost34`, {
      data: { docType: 'SPEC', specificationVersion: v1.snapshot.version },
    });
    expect(issued.status(), await issued.text()).toBe(200);
    await expect
      .poll(async () => (await maybeSpec(page, id, v1.snapshot.version))?.snapshot.status)
      .toBe('released');

    // (3) Следующий GPL: новая цена, новый партномер вместо A-LIC, исчезнувшая A-OLD.
    const next = await importGpl(
      page,
      vendorAId,
      'vendor-a-v2.csv',
      'Name;SKU;Unit;Price\n' +
        'Сервер A;A-SRV;шт.;110\n' +
        'Лицензия A v2;A-LIC-2;шт.;21\n' +
        'Лицензия A расширенная;A-LIC-EXT;шт.;30\n',
    );
    const lic2 = (await catalog(page)).products.find(
      (p) => p.vendorId === vendorAId && p.sku === 'A-LIC-2',
    )!;
    await catalogAction(page, {
      action: 'relation.create',
      relation: {
        type: 'replaces',
        fromProductId: lic2.id,
        toProductId: lic.id,
        note: 'Новый GPL',
      },
    });

    // (4) Выборочное обновление: только цена сервера; ручная цена A-LIC-EXT сохраняется.
    await openSpecification(page, id);
    const updates = page.getByRole('region', {
      name: 'Обновление спецификации из GPL',
      exact: true,
    });
    await updates
      .getByRole('combobox', { name: 'GPL для обновления проекта', exact: true })
      .selectOption(next.id);
    await updates.getByRole('button', { name: 'Проверить предложения GPL' }).click();
    await expect(updates).toContainText('Нет совпадения в подтвержденном наборе нового GPL');
    await expect(updates).toContainText('GPL другого вендора');
    const extUpdate = updates.getByRole('group', {
      name: 'Обновление позиции 3: Лицензия A расширенная',
      exact: true,
    });
    await expect(
      extUpdate.getByLabel('Обновить Цена: Лицензия A расширенная', { exact: true }),
    ).toBeDisabled();
    const srvUpdate = updates.getByRole('group', {
      name: 'Обновление позиции 1: Сервер A',
      exact: true,
    });
    await expect(srvUpdate.getByLabel('Обновить Цена: Сервер A', { exact: true })).toBeChecked();
    await updates.getByRole('button', { name: 'Пересчитать выбранные изменения GPL' }).click();
    await updates
      .getByRole('button', { name: 'Применить выбранные поля в новую редакцию' })
      .click();
    await expect(row(page, 1).getByLabel(PRICE)).toHaveValue('110');
    const afterGpl = await spec(page, id);
    expect(afterGpl.snapshot.status).toBe('draft');
    const item = (s: SavedSpecification, sku: string) =>
      s.snapshot.items.find((i) => i.sku === sku)!;
    expect(item(afterGpl, 'A-LIC-EXT').unitPrice).toBe('22');
    expect(item(afterGpl, 'A-OLD')).toEqual(item(v1, 'A-OLD'));
    expect(item(afterGpl, 'B-NET')).toEqual(item(v1, 'B-NET'));
    expect(afterGpl.snapshot.items[5]).toEqual(v1.snapshot.items[5]);

    // Замененный партномер: явная замена в новую черновую редакцию (не автоматически).
    const replacements = page.getByTestId('catalog-replacements');
    await expect(replacements).toContainText('заменено на');
    await replacements.getByLabel('Цена замены').selectOption({ index: 1 });
    page.once('dialog', (dialog) => dialog.accept());
    await replacements.getByRole('button', { name: 'Заменить' }).click();
    await expect(row(page, 2).getByLabel('Артикул / редакция')).toHaveValue('A-LIC-2');
    await expect(row(page, 2).getByLabel(QTY)).toHaveValue('3');
    const replaced = await spec(page, id);
    expect(replaced.snapshot.version).toBe(afterGpl.snapshot.version + 1);
    expect(item(replaced, 'A-LIC-2').unitPrice).toBe('21');

    // Выпущенный комплект не изменился ни от нового GPL, ни от замены.
    const released = await spec(page, id, v1.snapshot.version);
    expect(released.snapshot.status).toBe('released');
    expect(released.snapshot.items).toEqual(v1.snapshot.items);
  });

  test('сайзинг: новая версия профиля и новые входы показывают влияние до применения', async ({
    page,
  }) => {
    test.setTimeout(240000);
    await loginAs(page, 'architect', E2E_PASSWORD!);
    const stamp = Date.now();
    const rules = (factor: number) => ({
      inputs: [{ key: 'clusters', label: 'Количество кластеров', type: 'number', min: 0 }],
      outputs: [
        {
          key: 'nodes',
          label: 'Узлы',
          kind: 'nodes',
          unit: 'шт.',
          formula: `clusters * ${factor}`,
          round: 'ceil',
        },
      ],
    });
    const profileRes = await page.request.post('/api/sizing/profiles', {
      data: { key: `e2e-${stamp}`, name: `E2E кластер ${stamp}`, domain: 'e2e' },
    });
    expect(profileRes.status(), await profileRes.text()).toBe(201);
    const profile = await profileRes.json();
    async function approvedVersion(factor: number) {
      const created = await page.request.post(`/api/sizing/profiles/${profile.id}/versions`, {
        data: { rules: rules(factor), assumptions: [], source: `E2E: узлы = кластеры × ${factor}` },
      });
      expect(created.status(), await created.text()).toBe(201);
      const version = await created.json();
      const approved = await page.request.post(`/api/sizing/versions/${version.id}`, {
        data: { action: 'approve', expectedHash: version.contentHash },
      });
      expect(approved.status(), await approved.text()).toBeLessThan(300);
      return version.id as string;
    }
    const v1 = await approvedVersion(2);

    await createProject(page, `Сайзинг 101 ${stamp}`, 'Заказчик сайзинга');
    const id = await createCalculationViaWizard(page);
    const saved = await page.request.post(`/api/calculations/${id}/specification`, {
      data: {
        version: 0,
        status: 'draft',
        emptySupplyReason: '',
        items: [
          {
            id: 'node',
            kind: 'hardware',
            disposition: 'supply',
            name: 'Узел кластера',
            vendor: 'Ручной',
            sku: 'NODE',
            quantity: '2',
            unit: 'шт.',
            configuration: '',
            licensing: '',
            term: '',
            source: 'Оценка',
            rationale: 'Сайзинг',
            confirmed: true,
            unitPrice: '100',
            currency: 'RUB',
          },
        ],
      },
    });
    expect(saved.status(), await saved.text()).toBe(201);
    const run = await page.request.post(`/api/calculations/${id}/sizing`, {
      data: { profileVersionId: v1, inputs: { clusters: 1 } },
    });
    expect(run.status(), await run.text()).toBe(201);
    const link = await page.request.post(`/api/calculations/${id}/sizing/link`, {
      data: { version: 1, itemId: 'node', runId: (await run.json()).id, metric: 'nodes' },
    });
    expect(link.status(), await link.text()).toBeLessThan(300);
    const linked = await spec(page, id);
    expect(linked.snapshot.items[0].sizingRef?.requiredQuantity).toBe('2');

    const v2 = await approvedVersion(3);
    await page.goto(`/calculations/${id}`);
    await page
      .getByRole('button', { name: /Сайзинг/ })
      .first()
      .click();
    const versionSelect = page.getByLabel('Профиль и версия');

    // Новые входы той же версии: дефицит и разница стоимости видны до применения.
    await page.waitForLoadState('networkidle');
    await versionSelect.selectOption(v1);
    const clusters = page.getByLabel('Количество кластеров');
    await clusters.fill('2');
    await expect(clusters).toHaveValue('2');
    await page.getByRole('button', { name: 'Предпросмотр влияния (без сохранения)' }).click();
    const impact = page
      .locator('.card')
      .filter({ has: page.getByRole('heading', { name: /^Влияние на спецификацию/ }) });
    const nodeRow = impact.locator('tr').filter({ hasText: 'Узел кластера' });
    await expect(nodeRow).toContainText('Дефицит');
    await expect(nodeRow).toContainText('2 → 4');
    await expect(nodeRow).toContainText('200 RUB');
    await expect(impact).toContainText('До: 200.00 RUB');
    await expect(impact).toContainText('После: 400.00 RUB');
    expect((await spec(page, id)).snapshot.version).toBe(linked.snapshot.version);

    // Новая версия профиля при прежних входах: влияние показывается, затем применяется явно.
    await versionSelect.selectOption(v2);
    await clusters.fill('1');
    await expect(clusters).toHaveValue('1');
    await page.getByRole('button', { name: 'Предпросмотр влияния (без сохранения)' }).click();
    await expect(nodeRow).toContainText('2 → 3');
    await expect(impact).toContainText('После: 300.00 RUB');
    expect((await spec(page, id)).snapshot.version).toBe(linked.snapshot.version);
    await page.getByRole('button', { name: 'Сохранить прогон' }).click();
    await expect(impact.getByLabel('Применить к Узел кластера')).toBeChecked();
    await impact
      .getByRole('button', { name: 'Применить выбранное (новая черновая редакция)' })
      .click();
    await expect
      .poll(async () => (await maybeSpec(page, id))?.snapshot.items[0].quantity)
      .toBe('3');
    const applied = await spec(page, id);
    expect(applied.snapshot.status).toBe('draft');
    expect(applied.snapshot.items[0].confirmed).toBe(false);
    expect(applied.snapshot.items[0].sizingRef?.requiredQuantity).toBe('3');
    expect((await spec(page, id, linked.snapshot.version)).snapshot.items[0].quantity).toBe('2');
  });

  test('полностью ручной состав и согласованность UI, КП, SPEC DOCX, SPEC.xlsx и ZIP', async ({
    page,
  }) => {
    test.setTimeout(300000);
    await loginAs(page, 'architect', E2E_PASSWORD!);
    const stamp = Date.now();
    // Курс в справочнике; в редакцию он копируется вместе с датой и источником.
    const today = new Date().toISOString().slice(0, 10);
    const rate = await page.request.post('/api/exchange-rates', {
      data: { from: 'USD', to: 'RUB', rate: '90.5', date: today, source: `E2E ЦБ ${stamp}` },
    });
    expect(rate.status(), await rate.text()).toBe(201);

    await createProject(page, `Ручной 101 ${stamp}`, 'Заказчик ручной');
    const id = await createCalculationViaWizard(page);
    // (6) Без каталога, GPL, вендора из справочника и ИИ: все строки вводятся вручную.
    await openSpecification(page, id);
    const rows: Array<{
      name: string;
      kind: string;
      qty: string;
      price: string;
      currency: string;
      licensing?: string;
    }> = [
      { name: 'Сервер ручной', kind: 'hardware', qty: '2', price: '1000.005', currency: 'RUB' },
      {
        name: 'Лицензия в долларах',
        kind: 'license',
        qty: '3',
        price: '10.333333',
        currency: 'USD',
        licensing: 'Бессрочная',
      },
      {
        name: 'Бесплатная утилита',
        kind: 'software',
        qty: '1',
        price: '0',
        currency: 'RUB',
        licensing: 'Freeware',
      },
      { name: 'Услуга без цены', kind: 'service', qty: '1', price: '', currency: 'RUB' },
    ];
    for (const [index, r] of rows.entries()) {
      await page.getByRole('button', { name: 'Добавить позицию', exact: true }).click();
      const group = row(page, index + 1);
      await group.getByLabel('Наименование', { exact: true }).fill(r.name);
      await group.getByRole('combobox', { name: 'Тип', exact: true }).selectOption(r.kind);
      await group.getByLabel('Вендор', { exact: true }).fill('Поставщик вне каталога');
      await group.getByLabel(QTY).fill(r.qty);
      await group.getByLabel('Источник', { exact: true }).fill('КП поставщика № 1');
      await group.getByLabel(RATIONALE).fill('Ручная оценка');
      await group.getByLabel(PRICE).fill(r.price);
      await group.getByLabel('Валюта', { exact: true }).fill(r.currency);
      if (r.licensing)
        await group.getByLabel('Лицензирование / право использования').fill(r.licensing);
      await group.getByLabel(CONFIRM_ROW).check();
    }
    const rates = page.getByTestId('spec-exchange-rates');
    await rates.getByRole('button', { name: 'из справочника' }).click();
    await expect(rates.getByLabel('Курс USD→RUB')).toHaveValue('90.5');
    await page.getByRole('button', { name: 'Подтвердить и сохранить' }).click();
    await expect.poll(async () => (await maybeSpec(page, id))?.snapshot.status).toBe('confirmed');
    const saved = await spec(page, id);
    const version = saved.snapshot.version;
    expect(saved.snapshot.items.every((i) => !i.origin)).toBe(true);
    expect(saved.snapshot.exchangeRates?.[0]).toMatchObject({
      from: 'USD',
      to: 'RUB',
      rate: '90.5',
      date: today,
    });

    // UI: точные суммы по валютам, округление при показе, неизвестная ≠ 0, бесплатная = 0.
    const totals = page.getByTestId('specification-totals');
    await expect(totals).toContainText(
      '2000.01 RUB — неполная сумма: неизвестна стоимость 1 из 3 поз.',
    );
    await expect(totals).toContainText('31.00 (точно: 30.999999) USD — 1 поз.');

    // SPEC.xlsx редакции: те же точные итоги.
    const xlsxRes = await page.request.get(
      `/api/calculations/${id}/specification/xlsx?version=${version}`,
    );
    expect(xlsxRes.status()).toBe(200);
    const specXlsxTotals = (body: Buffer) =>
      XLSX.utils
        .sheet_to_json<unknown[]>(XLSX.read(body, { type: 'buffer' }).Sheets['Итоги'], {
          header: 1,
        })
        .slice(1, 3);
    const expectedTotals = [
      ['RUB', 2000.01, 3, 1, 'Неполная сумма'],
      ['USD', 30.999999, 1, 0, 'Полная'],
    ];
    expect(specXlsxTotals(await xlsxRes.body())).toEqual(expectedTotals);

    // SPEC DOCX (выпуск): тот же итог и пометка неполноты.
    const docx = await page.request.post(`/api/calculations/${id}/gost34`, {
      data: { docType: 'SPEC', specificationVersion: version },
    });
    expect(docx.status(), await docx.text()).toBe(200);
    const docxText = async (body: Buffer) =>
      (await (await JSZip.loadAsync(body)).file('word/document.xml')!.async('string')).replace(
        /<[^>]+>/g,
        '',
      );
    const specText = await docxText(await docx.body());
    for (const fragment of [
      'Итого RUB: 2000.01 RUB — неполная сумма: неизвестна стоимость 1 из 3 поз.',
      'Итого USD: 31.00 (точно: 30.999999) USD — 1 поз.',
      'Бесплатная утилита',
      'Цена неизвестна',
    ])
      expect(specText).toContain(fragment);

    // ZIP комплекта несет ту же редакцию: SPEC.xlsx и SPEC DOCX с теми же итогами.
    const zipRes = await page.request.post(`/api/calculations/${id}/gost34`, {
      data: {
        isBatchZip: true,
        specificationVersion: version,
        developer: 'Иванов И.И.',
        checker: 'Петров П.П.',
        normControl: 'Сидоров С.С.',
        approver: 'Кузнецов К.К.',
        customerApprover: 'Смирнов С.С.',
      },
    });
    expect(zipRes.status(), await zipRes.text()).toBe(200);
    const zip = await JSZip.loadAsync(await zipRes.body());
    expect(specXlsxTotals(await zip.file('SPEC.xlsx')!.async('nodebuffer'))).toEqual(
      expectedTotals,
    );
    const zipSpec = Object.keys(zip.files).find((n) => /SPEC/.test(n) && n.endsWith('.docx'));
    expect(zipSpec).toBeTruthy();
    const zipText = await docxText(await zip.file(zipSpec!)!.async('nodebuffer'));
    expect(zipText).toContain('Итого USD: 31.00 (точно: 30.999999) USD — 1 поз.');

    // КП: поставка из закрепленной редакции; USD по курсу из снимка; итог помечен неполным.
    const pin = await page.request.patch(`/api/calculations/${id}/commercial`, {
      data: { pinnedSpecificationVersion: version },
    });
    expect(pin.status(), await pin.text()).toBe(200);
    const commercial = await (await page.request.get(`/api/calculations/${id}/commercial`)).json();
    const supply = commercial.summary.supply;
    // 2 × 1000.005 + 3 × 10.333333 × 90.5 + 0 = 2000.01 + 2805.4999095 = 4805.5099095 →
    // 4805.51: строка считается точно, округляется только итог (без двойного округления).
    expect(supply.supplyPrice).toBe(4805.51);
    expect(supply.lines.find((l: { name: string }) => l.name === 'Лицензия в долларах').sale).toBe(
      '2805.4999095',
    );
    expect(supply.incomplete).toBe(true);
    expect(commercial.summary.total.incomplete).toBe(true);
    expect(JSON.stringify(supply.lines)).toContain(`курс 90.5 (${today}, E2E ЦБ ${stamp})`);
    const kpXlsx = await page.request.get(`/api/calculations/${id}/xlsx`);
    expect(kpXlsx.status()).toBe(200);
    const kpBook = XLSX.read(await kpXlsx.body(), { type: 'buffer' });
    const kpCells = kpBook.SheetNames.flatMap((name) =>
      XLSX.utils.sheet_to_json<unknown[]>(kpBook.Sheets[name], { header: 1 }).flat(),
    );
    expect(kpCells).toContain(4805.51);
    expect(kpCells.some((c) => typeof c === 'string' && /неполн/i.test(c))).toBe(true);
    const pdf = await page.request.get(`/api/calculations/${id}/pdf`);
    expect(pdf.status()).toBe(200);
    expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF');
    // UI «Итог КП» показывает ту же поставку.
    await page.goto(`/calculations/${id}`);
    await page
      .getByRole('button', { name: /Смета и КП/ })
      .first()
      .click();
    const supplyLines = page.getByTestId('supply-lines');
    await expect(supplyLines).toContainText('Лицензия в долларах');
    await expect(supplyLines).toContainText('90.5');
    await expect(page.getByText(/неполн/i).first()).toBeVisible();
    // Повторное открытие спецификации — та же редакция и итоги.
    await openSpecification(page, id);
    await expect(totals).toContainText('31.00 (точно: 30.999999) USD — 1 поз.');
    const reopened: SpecificationSnapshot = (await spec(page, id)).snapshot;
    expect(reopened.items).toEqual(saved.snapshot.items);
  });
});
