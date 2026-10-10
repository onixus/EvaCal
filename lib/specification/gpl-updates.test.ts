import { describe, expect, it, vi } from 'vitest';
vi.mock('./store', () => ({ loadSpecification: vi.fn(), saveSpecification: vi.fn() }));
vi.mock('../catalog/import-store', () => ({ loadImport: vi.fn() }));
import { buildGplUpdatePreview, applyGplUpdate, previewGplUpdate } from './gpl-updates';
import { applyGplUpdateSelections, summarizeSpecification } from './gpl-update-selection';
import { parseSpecification } from './validation';
import { loadSpecification, saveSpecification } from './store';
import { loadImport } from '../catalog/import-store';
import type { ImportDraft, ImportRow } from '../catalog/import-types';
import type { SpecificationItem, SpecificationSnapshot } from './types';
import type { SpecificationImportOrigin } from './gpl-update-types';
const checksum = 'a'.repeat(64),
  targetChecksum = 'b'.repeat(64);
function importRow(sku = 'SKU', price: string | null = '10'): ImportRow {
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
        edition: 'Edition A',
        name: 'Product',
        kind: 'hardware',
        unit: 'шт',
        licensing: 'per node',
        attributes: [{ name: 'RAM', value: '8', unit: 'GB' }],
      },
      offer: {
        source: 'Original',
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
function batch(id = 'old', rows = [importRow()]): ImportDraft {
  return {
    id,
    revision: 2,
    revisionCreatedBy: 'u',
    revisionCreatedAt: '2026-10-10T10:00:00Z',
    status: 'confirmed',
    filename: `${id}.csv`,
    checksum: id === 'old' ? checksum : targetChecksum,
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
const originalSource: SpecificationImportOrigin = {
  importId: 'old',
  revision: 2,
  checksum,
  sheet: 'GPL',
  rowNumber: 2,
};
function item(id = 'i'): SpecificationItem {
  const fields = {
    name: 'Product',
    kind: 'hardware' as const,
    unit: 'шт',
    configuration: 'Редакция: Edition A; RAM: 8 GB',
    licensing: 'per node',
    term: '12 months',
    source: 'Copied immutable catalog offer',
    unitPrice: '10',
    currency: 'RUB',
  };
  return {
    id,
    ...fields,
    vendor: 'Vendor',
    sku: 'SKU',
    quantity: '2',
    disposition: 'supply',
    rationale: 'Confirmed need',
    confirmed: true,
    origin: {
      vendorId: 'v',
      vendorName: 'Vendor',
      productId: 'p',
      productRevision: 1,
      offerId: 'o',
      sku: 'SKU',
      edition: 'Edition A',
      import: structuredClone(originalSource),
      baseline: { ...fields },
    },
  };
}
const snapshot = (items = [item()]): SpecificationSnapshot => ({
  version: 3,
  status: 'confirmed',
  emptySupplyReason: '',
  items,
});
const clone = <T>(value: T): T => structuredClone(value);
const resolve = async () => batch();
describe('selected GPL project updates', () => {
  it('offers verified differences and appends only selected fields without touching project decisions', async () => {
    const current = snapshot(),
      target = batch('new', [importRow('SKU', '20')]);
    const preview = await buildGplUpdatePreview(current, target, resolve);
    const savedOriginal = clone(current);
    const next = applyGplUpdateSelections(current, preview, [
      { itemId: 'i', fields: ['unitPrice', 'currency'] },
    ]);
    expect(next.status).toBe('draft');
    expect(next.items[0].confirmed).toBe(false);
    expect(next.items[0]).toMatchObject({
      id: 'i',
      unitPrice: '20',
      quantity: '2',
      disposition: 'supply',
      rationale: 'Confirmed need',
      vendor: 'Vendor',
      sku: 'SKU',
      term: '12 months',
    });
    expect(next.items[0].origin?.fieldSources?.unitPrice).toMatchObject({
      importId: 'new',
      revision: 2,
      checksum: targetChecksum,
    });
    expect(next.items[0].origin?.import).toEqual(originalSource);
    expect(current).toEqual(savedOriginal);
    expect(preview.totals).toEqual({
      before: [{ currency: 'RUB', total: '20', unknownCount: 0, includedCount: 1 }],
      after: [{ currency: 'RUB', total: '40', unknownCount: 0, includedCount: 1 }],
    });
  });
  it.each(['marker', 'value', 'currency'] as const)(
    'keeps manual price detected by %s unless per-row consent',
    async (mode) => {
      const current = snapshot();
      if (mode === 'marker') current.items[0].priceOverride = true;
      if (mode === 'value') current.items[0].unitPrice = '12';
      if (mode === 'currency') current.items[0].currency = 'USD';
      const preview = await buildGplUpdatePreview(
        current,
        batch('new', [importRow('SKU', '20')]),
        resolve,
      );
      expect(preview.rows[0].manualPrice).toBe(true);
      expect(preview.selections.flatMap((s) => s.fields)).not.toContain('unitPrice');
      expect(() =>
        applyGplUpdateSelections(current, preview, [
          { itemId: 'i', fields: ['unitPrice', 'currency'] },
        ]),
      ).toThrow(/Ручная цена/);
      const next = applyGplUpdateSelections(current, preview, [
        { itemId: 'i', fields: ['unitPrice', 'currency'], allowPriceOverride: true },
      ]);
      expect(next.items[0].unitPrice).toBe('20');
      expect(next.items[0].currency).toBe('RUB');
      expect(next.items[0].priceOverride).toBe(false);
    },
  );
  it('ignores forged copied baseline when deciding whether current price is manual', async () => {
    const current = snapshot();
    current.items[0].unitPrice = '12';
    current.items[0].origin!.baseline.unitPrice = '12';
    const preview = await buildGplUpdatePreview(
      current,
      batch('new', [importRow('SKU', '20')]),
      resolve,
    );
    expect(preview.rows[0].manualPrice).toBe(true);
    expect(preview.rows[0].changes.find((c) => c.field === 'unitPrice')?.defaultSelected).toBe(
      false,
    );
  });
  it('preserves manually edited technical fields by default but allows explicit selection', async () => {
    const current = snapshot();
    current.items[0].name = 'Project-specific name';
    const target = batch('new');
    target.rows[0].normalized!.product.name = 'Updated name';
    const preview = await buildGplUpdatePreview(current, target, resolve);
    expect(preview.rows[0].changes.find((c) => c.field === 'name')).toMatchObject({
      manuallyEdited: true,
      defaultSelected: false,
    });
    expect(applyGplUpdateSelections(current, preview, preview.selections).items[0].name).toBe(
      'Project-specific name',
    );
    expect(
      applyGplUpdateSelections(current, preview, [{ itemId: 'i', fields: ['name'] }]).items[0].name,
    ).toBe('Updated name');
  });
  it('requires atomic price/currency selection even when just currency changes', async () => {
    const target = batch('new');
    target.rows[0].normalized!.offer.currency = 'USD';
    const preview = await buildGplUpdatePreview(snapshot(), target, resolve);
    expect(
      preview.rows[0].changes.filter((c) => ['unitPrice', 'currency'].includes(c.field)),
    ).toHaveLength(2);
    expect(() =>
      applyGplUpdateSelections(snapshot(), preview, [{ itemId: 'i', fields: ['currency'] }]),
    ).toThrow(/выбираются вместе/);
  });
  it('leaves unlinked legacy/manual, edited SKU, missing and ambiguous entries untouched', async () => {
    const legacy = item('legacy');
    delete legacy.origin;
    legacy.source = 'Каталог p; GPL new; SKU';
    const edited = item('edited');
    edited.sku = 'MANUAL-SKU';
    const missing = item('missing');
    missing.sku = 'MISSING';
    missing.origin!.sku = 'MISSING';
    const source = batch('old', [importRow(), { ...importRow('MISSING'), rowNumber: 3 }]);
    missing.origin!.import!.rowNumber = 3;
    const current = snapshot([legacy, edited, missing]);
    const preview = await buildGplUpdatePreview(current, batch('new'), async () => source);
    expect(preview.rows.map((r) => r.status)).toEqual(['unlinked', 'unlinked', 'missing']);
    expect(preview.selections).toEqual([]);
    expect(applyGplUpdateSelections(current, preview, [])).toEqual(current);
    const duplicate = await buildGplUpdatePreview(
      snapshot(),
      batch('new', [importRow(), { ...importRow(), rowNumber: 3 }]),
      resolve,
    );
    expect(duplicate.rows[0].status).toBe('ambiguous');
    expect(() =>
      applyGplUpdateSelections(snapshot(), duplicate, [
        { itemId: 'i', fields: ['unitPrice', 'currency'] },
      ]),
    ).toThrow(/несопоставленная/);
  });
  it.each(['checksum', 'revision', 'draft', 'vendor', 'malformed'] as const)(
    'rejects unverifiable historical source %s',
    async (mode) => {
      const current = snapshot(),
        source = batch();
      if (mode === 'checksum') source.checksum = targetChecksum;
      if (mode === 'revision') source.revision = 1;
      if (mode === 'draft') source.status = 'draft';
      if (mode === 'vendor') source.profile.vendorId = 'other';
      if (mode === 'malformed') source.rows[0].normalized = null;
      const preview = await buildGplUpdatePreview(current, batch('new'), async () => source);
      expect(preview.rows[0].status).toBe('invalid');
      expect(preview.selections).toEqual([]);
    },
  );
  it('checks per-field origins after a partial update without losing the original price baseline', async () => {
    const target = batch('new', [importRow('SKU', '20')]);
    target.rows[0].normalized!.offer.terms = '24 months';
    const first = await buildGplUpdatePreview(snapshot(), target, resolve);
    const partial = applyGplUpdateSelections(snapshot(), first, [
      { itemId: 'i', fields: ['term'] },
    ]);
    expect(partial.items[0].unitPrice).toBe('10');
    expect(partial.items[0].origin?.fieldSources?.term?.importId).toBe('new');
    const second = await buildGplUpdatePreview(partial, target, async (source) =>
      source.importId === 'new' ? target : batch(),
    );
    expect(second.rows[0].manualPrice).toBe(false);
    expect(second.rows[0].changes.some((c) => c.field === 'term')).toBe(false);
    expect(second.rows[0].changes.find((c) => c.field === 'unitPrice')).toMatchObject({
      defaultSelected: true,
      before: '10',
      after: '20',
    });
  });
  it('compares source decimal formatting exactly and differentiates unknown from zero', async () => {
    const current = snapshot();
    current.items[0].unitPrice = '10.000000';
    const same = await buildGplUpdatePreview(current, batch('new'), resolve);
    expect(same.rows[0].manualPrice).toBe(false);
    expect(same.rows[0].changes.some((c) => c.field === 'unitPrice')).toBe(false);
    const unknown = snapshot();
    unknown.items[0].unitPrice = null;
    const p = await buildGplUpdatePreview(
      unknown,
      batch('new', [importRow('SKU', '0')]),
      async () => batch('old', [importRow('SKU', null)]),
    );
    expect(p.rows[0].manualPrice).toBe(false);
    expect(p.rows[0].changes.find((c) => c.field === 'unitPrice')).toMatchObject({
      before: null,
      after: '0',
    });
  });
  it('sums exact high-precision prices per currency with partial unknown totals and no FX', () => {
    const a = item('a');
    a.quantity = '999999999999.999999';
    a.unitPrice = '999999999999.999999';
    const b = item('b');
    b.currency = 'USD';
    b.unitPrice = null;
    const free = item('free');
    free.currency = 'USD';
    free.unitPrice = '0';
    const existing = item('existing');
    existing.disposition = 'existing';
    expect(summarizeSpecification(snapshot([a, b, free, existing]))).toEqual([
      {
        currency: 'RUB',
        total: '999999999999999998000000.000000000001',
        unknownCount: 0,
        includedCount: 1,
      },
      { currency: 'USD', total: '0', unknownCount: 1, includedCount: 2 },
    ]);
  });
  it('rejects duplicate items, unknown fields, impossible choices and stale previews', async () => {
    const current = snapshot(),
      preview = await buildGplUpdatePreview(
        current,
        batch('new', [importRow('SKU', '20')]),
        resolve,
      );
    expect(() =>
      applyGplUpdateSelections(current, preview, [
        { itemId: 'i', fields: ['term'] },
        { itemId: 'i', fields: ['term'] },
      ]),
    ).toThrow(/повторные/);
    expect(() =>
      applyGplUpdateSelections(current, preview, [{ itemId: 'i', fields: ['quantity'] }]),
    ).toThrow(/поля выбора/);
    current.items[0].unitPrice = '11';
    expect(() =>
      applyGplUpdateSelections(current, preview, [
        { itemId: 'i', fields: ['unitPrice', 'currency'] },
      ]),
    ).toThrow(/после предпросмотра/);
  });
  it('strictly persists optional provenance while legacy snapshots remain supported', () => {
    const original = snapshot(),
      parsed = parseSpecification(original);
    expect(parsed.items[0].origin).toEqual(original.items[0].origin);
    const legacy = item();
    delete legacy.origin;
    expect(parseSpecification(snapshot([legacy])).items[0].origin).toBeUndefined();
    const forged = clone(original);
    Object.assign(forged.items[0].origin!, { unexpected: true });
    expect(() => parseSpecification(forged)).toThrow(/Неизвестное поле/);
    forged.items[0].origin = clone(original.items[0].origin!);
    forged.items[0].origin!.import!.checksum = 'bad';
    expect(() => parseSpecification(forged)).toThrow(/происхождение/);
  });
  it('recomputes server proposals and saves a new draft with the verified version', async () => {
    const current = snapshot(),
      target = batch('new', [importRow('SKU', '20')]);
    vi.mocked(loadSpecification).mockResolvedValue({
      id: 's',
      snapshot: current,
      createdAt: 'now',
      createdBy: 'u',
    });
    vi.mocked(loadImport).mockImplementation(async (id) => (id === 'new' ? target : batch()));
    vi.mocked(saveSpecification).mockImplementation(async (_calc, next) => ({
      id: 'new-spec',
      snapshot: parseSpecification(next),
      createdAt: 'now',
      createdBy: 'actor',
    }));
    await applyGplUpdate(
      'calc',
      {
        version: 3,
        targetImportId: 'new',
        targetRevision: 2,
        targetChecksum,
        selections: [{ itemId: 'i', fields: ['unitPrice', 'currency'] }],
        proposal: { unitPrice: '999' },
      },
      'actor',
    );
    expect(saveSpecification).toHaveBeenLastCalledWith(
      'calc',
      expect.objectContaining({
        version: 3,
        status: 'draft',
        items: [expect.objectContaining({ unitPrice: '20', confirmed: false })],
      }),
      'actor',
      { allowOriginUpdates: true },
    );
    await expect(
      previewGplUpdate('calc', 'new', [], { version: 2, targetRevision: 2, targetChecksum }),
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      applyGplUpdate(
        'calc',
        {
          version: 3,
          targetImportId: 'new',
          targetRevision: 2,
          targetChecksum: 'c'.repeat(64),
          selections: [{ itemId: 'i', fields: ['unitPrice', 'currency'] }],
        },
        'actor',
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
  it('does not apply prices from the original vendor after a manual vendor relabel', async () => {
    const current = snapshot();
    current.items[0].vendor = 'Different vendor';
    const preview = await buildGplUpdatePreview(
      current,
      batch('new', [importRow('SKU', '20')]),
      resolve,
    );
    expect(preview.rows[0].status).toBe('unlinked');
    expect(preview.rows[0].reason).toMatch(/Вендор изменен/);
    expect(preview.selections).toEqual([]);
  });
  it('does not propose a text-only source rewrite for the same confirmed GPL', async () => {
    const preview = await buildGplUpdatePreview(snapshot(), batch('old'), resolve);
    expect(preview.rows[0].status).toBe('matched');
    expect(preview.rows[0].changes).toEqual([]);
    expect(preview.selections).toEqual([]);
    expect(preview.totals.after).toEqual(preview.totals.before);
  });
});
