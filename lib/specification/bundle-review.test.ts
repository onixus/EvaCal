import { describe, expect, it, vi } from 'vitest';
vi.mock('../prisma', () => ({ prisma: {} }));
import * as XLSX from 'xlsx';
import type { SpecificationItem, SpecificationSnapshot } from './types';
import { parseSpecification } from './validation';
import { renderSpecificationXlsx, SPEC_XLSX_HEADERS, SPEC_XLSX_SHEETS } from './xlsx';
import { analyzeBom, parseBomProfile } from './bom-import';
import { mergeBomRows } from './bom-types';
import { diffSpecifications } from './diff';
import { summarizeSpecification } from './totals';
import { syncBundleComponents, type ProductRelation } from '../catalog/relations';
import { productInput } from '../catalog/validation';
import { catalogItem } from '../catalog/snapshot';
import { requireKindCompatibleWithRelations } from '../catalog/store';
import type { Offer, Product } from '../catalog/types';
import { replaceInItems, replacementCandidates } from './replacements';

const row = (id: string, patch: Partial<SpecificationItem> = {}): SpecificationItem => ({
  id,
  kind: 'hardware',
  disposition: 'supply',
  name: id,
  vendor: 'V',
  sku: id,
  quantity: '1',
  unit: 'шт.',
  configuration: '',
  licensing: '',
  term: '',
  source: 's',
  rationale: 'r',
  confirmed: true,
  unitPrice: '10',
  currency: 'RUB',
  ...patch,
});
const snapshot = (items: SpecificationItem[], version = 1): SpecificationSnapshot =>
  parseSpecification({ version, status: 'draft', emptySupplyReason: '', items });

describe('L4: количества состава следуют количеству комплектов', () => {
  it('компоненты = комплекты × на комплект; неизвестное количество комплектов → неизвестно', () => {
    const items = [
      row('kit', { kind: 'bundle', quantity: '5' }),
      row('a', { includedIn: 'kit', perBundle: '2', quantity: '6' }),
      row('b', { includedIn: 'kit', quantity: '7' }),
      row('c'),
    ];
    const synced = syncBundleComponents(items, 'kit');
    expect(synced.map((i) => [i.id, i.quantity, i.confirmed])).toEqual([
      ['kit', '5', true],
      ['a', '10', false],
      ['b', '7', true],
      ['c', '1', true],
    ]);
    const unknown = syncBundleComponents([{ ...items[0], quantity: null }, items[1]], 'kit');
    expect(unknown[1].quantity).toBeNull();
    expect(syncBundleComponents(items, 'c')).toBe(items);
  });
  it('perBundle допустим только у компонента и положителен', () => {
    expect(() => snapshot([row('x', { perBundle: '2' })])).toThrow(/на комплект/);
    expect(() =>
      snapshot([row('kit', { kind: 'bundle' }), row('a', { includedIn: 'kit', perBundle: '0' })]),
    ).toThrow(/на комплект/);
  });
});

describe('L6: сравнение редакций не показывает сумму компонента', () => {
  it('добавленный компонент и изменение состава помечены, сумма компонента не считается', () => {
    const before = snapshot([row('kit', { kind: 'bundle' }), row('a', { unitPrice: '5' })], 1);
    const after = snapshot(
      [
        row('kit', { kind: 'bundle' }),
        row('a', { unitPrice: '5', includedIn: 'kit' }),
        row('n', { includedIn: 'kit' }),
      ],
      2,
    );
    const diff = diffSpecifications(before, after);
    expect(diff.added).toEqual([
      expect.objectContaining({ id: 'n', amount: null, bundleComponent: true }),
    ]);
    expect(diff.changed[0]).toMatchObject({
      id: 'a',
      amount: { before: '5', after: null },
      bundleComponent: { before: false, after: true },
    });
    expect(diff.totals[0]).toMatchObject({ delta: '-5' });
  });
});

describe('L5: XLSX колонка комплекта и обратный импорт BOM', () => {
  const spec = snapshot([
    row('kit', { kind: 'bundle', name: 'Комплект', unit: 'компл.', unitPrice: '1000' }),
    row('srv', { name: 'Сервер', includedIn: 'kit', unitPrice: '700', quantity: '2' }),
    row('extra', { name: 'Кабель', unitPrice: '5' }),
  ]);
  const file = renderSpecificationXlsx(spec, { calculationName: 'x', customer: 'y' });
  it('экспорт содержит колонку «Входит в комплект»', () => {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(
      XLSX.read(file, { type: 'buffer' }).Sheets[SPEC_XLSX_SHEETS.items],
      { header: 1 },
    );
    const column = SPEC_XLSX_HEADERS.indexOf('Входит в комплект (ID строки)');
    expect(column).toBeGreaterThan(0);
    const byName = new Map(rows.slice(1).map((r) => [String(r[2]), r]));
    expect(byName.get('Сервер')![column]).toBe('kit');
    expect(byName.get('Комплект')![column] ?? '').toBe('');
  });
  it('импорт восстанавливает состав и не удваивает итог', () => {
    const preview = analyzeBom(
      file,
      'SPEC.xlsx',
      parseBomProfile({ sheet: SPEC_XLSX_SHEETS.items }),
    );
    expect(preview.rows.every((r) => !r.errors.length)).toBe(true);
    const items = preview.rows.map((r) => r.item!);
    const bundle = items.find((i) => i.name === 'Комплект')!;
    expect(items.find((i) => i.name === 'Сервер')!.includedIn).toBe(bundle.id);
    const merged = mergeBomRows(
      { version: 0, status: 'draft', emptySupplyReason: '', items: [] },
      preview,
      preview.rows.map((r) => r.id),
      'replace',
    );
    expect(summarizeSpecification(snapshot(merged.items))[0].total).toBe('1005');
    // A component without its bundle row is rejected, never imported as a priced row.
    const component = preview.rows.find((r) => r.item?.name === 'Сервер')!;
    expect(() =>
      mergeBomRows({ version: 0, status: 'draft', emptySupplyReason: '', items: [] }, preview, [
        component.id,
      ]),
    ).toThrow(/комплекта/);
  });
  it('компонент без строки комплекта в файле — ошибка строки', () => {
    const lone = renderSpecificationXlsx(
      snapshot([
        row('kit', { kind: 'bundle', name: 'Комплект' }),
        row('srv', { name: 'Сервер', includedIn: 'kit' }),
      ]),
      { calculationName: 'x', customer: 'y' },
    );
    const wb = XLSX.read(lone, { type: 'buffer' });
    const ws = wb.Sheets[SPEC_XLSX_SHEETS.items];
    const data = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 });
    const kitIndex = data.findIndex((r) => r[2] === 'Комплект');
    data.splice(kitIndex, 1);
    wb.Sheets[SPEC_XLSX_SHEETS.items] = XLSX.utils.aoa_to_sheet(data);
    const preview = analyzeBom(
      XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }),
      'SPEC.xlsx',
      parseBomProfile({ sheet: SPEC_XLSX_SHEETS.items }),
    );
    expect(preview.rows[0].item).toBeNull();
    expect(preview.rows[0].errors.join(' ')).toMatch(/строка комплекта отсутствует/);
  });
});

function product(id: string, kind: Product['kind'] = 'hardware'): Product {
  const p: Product = {
    id,
    revision: 1,
    archived: false,
    vendorId: 'v',
    vendor: { id: 'v', name: 'Вендор', revision: 1, archived: false },
    name: `Позиция ${id}`,
    sku: id.toUpperCase(),
    edition: '',
    kind,
    unit: 'шт.',
    licensing: '',
    attributes: [],
    offers: [],
  };
  const offer: Offer = {
    id: `${id}-offer`,
    productRevision: 1,
    source: 'GPL',
    unitPrice: '100',
    currency: 'RUB',
    region: '',
    terms: '',
    priceDate: null,
    validUntil: null,
    confirmationStatus: 'confirmed',
    confirmedBy: 'u',
    confirmedAt: 'now',
    createdAt: 'now',
    createdBy: 'u',
    productSnapshot: {
      ...productInput(p),
      id,
      revision: 1,
      vendor: { id: 'v', name: 'Вендор', revision: 1 },
    },
  };
  return { ...p, offers: [offer] };
}
const relation = (
  id: string,
  from: string,
  to: string,
  type: ProductRelation['type'],
  quantity: string | null = null,
): ProductRelation => ({
  id,
  fromProductId: from,
  toProductId: to,
  type,
  quantity,
  note: '',
  createdBy: 'u',
  createdAt: 'now',
  archivedAt: null,
  archivedBy: null,
});

describe('M3: замена с учетом комплектов', () => {
  const oldKit = product('oldkit', 'bundle');
  const newKit = product('newkit', 'bundle');
  const plain = product('plain');
  const part = product('part');
  const nodeA = product('nodea');
  const nodeB = product('nodeb');
  const products = [oldKit, newKit, plain, part, nodeA, nodeB];
  const relations = [
    relation('r-kit', 'newkit', 'oldkit', 'replaces'),
    relation('r-plain', 'plain', 'oldkit', 'replaces'),
    relation('r-part', 'newkit', 'part', 'replaces'),
    relation('c1', 'newkit', 'nodeb', 'bundleComponent', '3'),
  ];
  const bundleRow = { ...catalogItem(oldKit, oldKit.offers[0], 'kit'), quantity: '2' };
  const component = {
    ...catalogItem(nodeA, undefined, 'node'),
    quantity: '4',
    includedIn: 'kit',
    perBundle: '2',
  };
  const partRow = { ...catalogItem(part, undefined, 'p'), includedIn: 'kit' };
  const items = [bundleRow, component, row('other')];
  const catalog = { products, relations };
  it('предпросмотр заранее показывает ограничения', () => {
    const [kit, componentCandidate] = replacementCandidates(
      { items: [...items, partRow] },
      products,
      relations,
    );
    expect(kit.componentCount).toBe(2);
    expect(kit.options.map((o) => [o.productId, o.isBundle, o.dropsComponents, o.blocked])).toEqual(
      [
        ['newkit', true, false, null],
        ['plain', false, true, null],
      ],
    );
    expect(componentCandidate).toMatchObject({ itemId: 'p', isComponent: true });
    expect(componentCandidate.options[0].blocked).toMatch(/вложенные/);
  });
  it('комплект → комплект: состав пересобирается по каталогу', () => {
    let n = 0;
    const next = replaceInItems(items, 'kit', newKit, newKit.offers[0], relations[0], catalog, {
      newId: () => `new-${++n}`,
    });
    expect(next.map((i) => [i.id, i.sku, i.quantity, i.includedIn ?? ''])).toEqual([
      ['kit', 'NEWKIT', '2', ''],
      ['new-1', 'NODEB', '6', 'kit'],
      ['other', 'other', '1', ''],
    ]);
    expect(next[0].changeReason).toMatch(/состав пересобран/);
    expect(() => snapshot(next)).not.toThrow();
  });
  it('комплект → не комплект: только с явным удалением состава', () => {
    expect(() => replaceInItems(items, 'kit', plain, undefined, relations[1], catalog)).toThrow(
      /подтвердите удаление состава/,
    );
    const next = replaceInItems(items, 'kit', plain, undefined, relations[1], catalog, {
      dropComponents: true,
    });
    expect(next.map((i) => i.id)).toEqual(['kit', 'other']);
    expect(next[0].kind).toBe('hardware');
  });
  it('компонент → комплект запрещен', () => {
    expect(() =>
      replaceInItems([bundleRow, partRow], 'p', newKit, undefined, relations[2], catalog),
    ).toThrow(/вложенные комплекты/);
  });
});

describe('M2: смена типа позиции согласуется со связями состава', () => {
  const tx = (counts: { components: number; parents: number }) =>
    ({
      catalogProductRelation: {
        count: vi.fn(async ({ where }: { where: { fromProductId?: string } }) =>
          where.fromProductId ? counts.components : counts.parents,
        ),
      },
    }) as never;
  it('комплект с компонентами не может стать не-комплектом', async () => {
    await expect(
      requireKindCompatibleWithRelations(
        tx({ components: 2, parents: 0 }),
        'p',
        'bundle',
        'hardware',
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringMatching(/архивируйте связи состава/),
    });
  });
  it('компонент не может стать комплектом', async () => {
    await expect(
      requireKindCompatibleWithRelations(
        tx({ components: 0, parents: 1 }),
        'p',
        'hardware',
        'bundle',
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
  it('без связей и без смены типа — разрешено', async () => {
    await expect(
      requireKindCompatibleWithRelations(
        tx({ components: 0, parents: 0 }),
        'p',
        'bundle',
        'hardware',
      ),
    ).resolves.toBeUndefined();
    await expect(
      requireKindCompatibleWithRelations(
        tx({ components: 5, parents: 5 }),
        'p',
        'bundle',
        'bundle',
      ),
    ).resolves.toBeUndefined();
  });
});
