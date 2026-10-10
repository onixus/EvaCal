import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./import-store', () => ({ loadImport: vi.fn() }));
import { loadImport } from './import-store';
import { compareImports, compareImportSnapshots } from './import-comparison';
import { SpecificationError } from '../specification/validation';
import type { ImportDraft, ImportRow } from './import-types';
function row(sku = 'SKU', price: string | null = '1', edition = ''): ImportRow {
  return {
    id: `GPL:${sku}`,
    sheet: 'GPL',
    rowNumber: 2,
    raw: [sku, price ?? ''],
    status: 'accepted',
    errors: [],
    normalized: {
      product: {
        vendorId: 'v',
        sku,
        edition,
        name: sku,
        kind: 'hardware',
        unit: 'шт',
        licensing: 'per node',
        attributes: [],
      },
      offer: {
        source: 'file.csv row2',
        unitPrice: price,
        currency: 'RUB',
        region: 'RU',
        terms: '12 months',
        priceDate: null,
        validUntil: null,
      },
    },
  };
}
function batch(id: string, rows: ImportRow[] = [row()]): ImportDraft {
  return {
    id,
    revision: 2,
    revisionCreatedBy: 'u',
    revisionCreatedAt: '2026-10-10T10:00:00Z',
    status: 'confirmed',
    filename: `${id}.csv`,
    checksum: `sha-${id}`,
    createdBy: 'u',
    createdAt: '2026-10-10T09:00:00Z',
    confirmedBy: 'u',
    confirmedAt: '2026-10-10T10:00:00Z',
    sheets: ['GPL'],
    headers: ['SKU'],
    profile: {
      vendorId: 'v',
      sheet: 'GPL',
      headerRow: 1,
      startRow: 2,
      endRow: null,
      delimiter: ';',
      decimalSeparator: '.',
      currency: 'RUB',
      kind: 'hardware',
      mapping: { sku: 0 },
    },
    rows,
  };
}
const clone = <T>(value: T): T => structuredClone(value);
function freeze(value: unknown): void {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
}
describe('confirmed GPL comparison', () => {
  beforeEach(() => vi.clearAllMocks());
  it('classifies additions, missing subsets, changed, unchanged and ambiguous rows', () => {
    const before = batch('old', [
      row('same'),
      row('missing'),
      row('changed', '1'),
      row('duplicate'),
      row('duplicate'),
    ]);
    const after = batch('new', [row('same'), row('added'), row('changed', '2'), row('duplicate')]);
    const result = compareImportSnapshots(before, after);
    expect(result.counts).toEqual({ added: 1, missing: 1, changed: 1, unchanged: 1, ambiguous: 1 });
    expect(result.rows.find((r) => r.sku === 'changed')?.changes).toEqual([
      { field: 'unitPrice', before: '1', after: '2' },
    ]);
    expect(result.rows.find((r) => r.sku === 'duplicate')?.changes).toEqual([]);
    expect(result.warnings.join()).toMatch(/не доказывает снятие/);
    expect(result.before.checksum).toBe('sha-old');
    expect(result.after.acceptedCount).toBe(4);
  });
  it('compares maximum precision exactly without collapsing nearby prices to a float', () => {
    const result = compareImportSnapshots(
      batch('old', [row('SKU', '999999999999.999998')]),
      batch('new', [row('SKU', '999999999999.999999')]),
    );
    expect(result.counts.changed).toBe(1);
    expect(result.rows[0].changes[0]).toEqual({
      field: 'unitPrice',
      before: '999999999999.999998',
      after: '999999999999.999999',
    });
  });
  it.each([
    ['1', '1.000000'],
    ['0', '0.000000'],
    ['123.450000', '123.45'],
  ])('treats decimal formatting %s/%s as equal', (a, b) => {
    expect(
      compareImportSnapshots(batch('a', [row('SKU', a)]), batch('b', [row('SKU', b)])).counts
        .unchanged,
    ).toBe(1);
  });
  it('preserves unknown versus free price', () => {
    expect(
      compareImportSnapshots(batch('a', [row('SKU', null)]), batch('b', [row('SKU', '0')])).rows[0]
        .changes,
    ).toEqual([{ field: 'unitPrice', before: null, after: '0' }]);
  });
  it('tracks technical details, currency, terms, region and dates separately', () => {
    const a = row(),
      b = clone(a);
    Object.assign(b.normalized!.product, {
      name: 'New name',
      unit: 'узел',
      licensing: 'per core',
      kind: 'software',
      attributes: [{ name: 'RAM', value: '8', unit: 'GB' }],
    });
    Object.assign(b.normalized!.offer, {
      currency: 'USD',
      terms: '24 months',
      region: 'TR',
      priceDate: '2026-10-01',
      validUntil: '2026-12-31',
    });
    const fields = compareImportSnapshots(batch('a', [a]), batch('b', [b])).rows[0].changes.map(
      (c) => c.field,
    );
    expect(fields).toEqual([
      'name',
      'kind',
      'unit',
      'licensing',
      'attributes',
      'currency',
      'region',
      'terms',
      'priceDate',
      'validUntil',
    ]);
  });
  it('ignores source filenames, physical row movement and incidental attribute order without modifying snapshots', () => {
    const a = row(),
      b = clone(a);
    a.normalized!.product.attributes = [
      { name: 'CPU', value: '4', unit: 'cores' },
      { name: 'RAM', value: '8', unit: 'GB' },
    ];
    b.normalized!.product.attributes = [...a.normalized!.product.attributes].reverse();
    b.normalized!.offer.source = 'next GPL.xlsx row99';
    b.sheet = 'NewSheet';
    b.rowNumber = 99;
    b.id = 'NewSheet:99';
    const before = batch('old', [a]),
      after = batch('new', [b]),
      saved = clone([before, after]);
    freeze(before);
    freeze(after);
    expect(compareImportSnapshots(before, after).counts.unchanged).toBe(1);
    expect([before, after]).toEqual(saved);
  });
  it('matches SKU only within identical edition and vendor', () => {
    const result = compareImportSnapshots(
      batch('a', [row('SKU', '1', 'A')]),
      batch('b', [row('SKU', '1', 'B')]),
    );
    expect(result.counts).toMatchObject({ added: 1, missing: 1, changed: 0 });
    const other = batch('b');
    other.profile.vendorId = 'different';
    expect(() => compareImportSnapshots(batch('a'), other)).toThrow(/одному вендору/);
  });
  it('fails closed for malformed or wrong-vendor accepted data', () => {
    const invalid = row('broken');
    invalid.normalized = null;
    const badPrice = row('price', '1e5');
    const wrongVendor = row('vendor');
    wrongVendor.normalized!.product.vendorId = 'other';
    const errorRow = row('error');
    errorRow.errors = ['Unresolved'];
    const result = compareImportSnapshots(
      batch('a', [invalid, badPrice, wrongVendor, errorRow]),
      batch('b', []),
    );
    expect(result.counts.ambiguous).toBe(4);
    expect(result.counts.missing).toBe(0);
    expect(result.rows.every((r) => r.changes.length === 0)).toBe(true);
  });
  it('restricts comparison to accepted subsets and warns about coverage', () => {
    const excluded = { ...row('excluded'), status: 'excluded' as const };
    const error = { ...row('error'), status: 'error' as const, errors: ['Invalid'] };
    const a = batch('a', [row(), excluded, error]);
    a.profile.endRow = 20;
    a.sheets = ['GPL', 'Other'];
    const result = compareImportSnapshots(a, batch('b'));
    expect(result.rows).toHaveLength(1);
    expect(result.before).toMatchObject({
      acceptedCount: 1,
      excludedCount: 1,
      errorCount: 1,
      endRow: 20,
    });
    expect(result.warnings.join()).toMatch(/часть строк/);
    expect(result.warnings.join()).toMatch(/диапазоном/);
    expect(result.warnings.join()).toMatch(/выбран только лист/);
  });
  it('rejects draft and identical batches', () => {
    const draft = batch('b');
    draft.status = 'draft';
    expect(() => compareImportSnapshots(batch('a'), draft)).toThrowError(
      expect.objectContaining({ statusCode: 409 }),
    );
    expect(() => compareImportSnapshots(batch('a'), batch('a'))).toThrow(/разных GPL/);
  });
  it('loads only persisted batches and preserves missing-source 404', async () => {
    const a = batch('a'),
      b = batch('b');
    vi.mocked(loadImport).mockImplementation(async (id) => (id === 'a' ? a : b));
    expect((await compareImports('a', 'b')).counts.unchanged).toBe(1);
    expect(loadImport).toHaveBeenNthCalledWith(1, 'a');
    expect(loadImport).toHaveBeenNthCalledWith(2, 'b');
    vi.mocked(loadImport).mockRejectedValue(new SpecificationError('Импорт не найден', 404));
    await expect(compareImports('missing', 'b')).rejects.toMatchObject({ statusCode: 404 });
  });
});
