import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  profile: vi.fn(),
  profileCreate: vi.fn(),
  profileUpdate: vi.fn(),
  importFind: vi.fn(),
  upsert: vi.fn(),
  products: vi.fn(),
  vendor: vi.fn(),
}));
vi.mock('../prisma', () => {
  const tx = {
    $queryRaw: vi.fn(async () => []),
    catalogVendor: { findUnique: mocks.vendor },
    catalogImport: { upsert: mocks.upsert },
    catalogImportProfile: { create: mocks.profileCreate },
  };
  return {
    prisma: {
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      catalogImportProfile: {
        findUnique: mocks.profile,
        findUniqueOrThrow: mocks.profile,
        updateMany: mocks.profileUpdate,
      },
      catalogImport: { findUnique: mocks.importFind },
      catalogProduct: { findMany: mocks.products },
    },
  };
});
import { createImport } from './import-store';
import { mutateImportProfile } from './import-profiles';
import { importProfile } from './import-parser';
import { applySavedSettings, settingsFromProfile } from './import-profile-match';

const original = importProfile({
  vendorId: 'v',
  delimiter: ';',
  decimalSeparator: ',',
  mapping: { name: 0, sku: 1, unit: 2, unitPrice: 3, priceDate: 4, taxRate: 5 },
  attributes: [{ column: 6, name: 'Память', unit: 'ГБ' }],
});
const originalHeaders = ['Название', 'Артикул', 'Ед.', 'Цена', 'Дата', 'НДС', 'RAM, ГБ'];
const settings = settingsFromProfile(original, originalHeaders);
const record = (over: Record<string, unknown> = {}) => ({
  id: 'prof-1',
  vendorId: 'v',
  name: 'Основной CSV',
  format: 'csv',
  profile: settings,
  revision: 2,
  archived: false,
  createdBy: 'u',
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedBy: 'u',
  updatedAt: new Date('2026-10-02T00:00:00Z'),
  ...over,
});

describe('saved profile header matching', () => {
  it('captures header names of every mapped column', () => {
    expect(settings.columns.unitPrice).toEqual({ index: 3, header: 'Цена' });
    expect(settings.attributes).toEqual([
      { index: 6, header: 'RAM, ГБ', name: 'Память', unit: 'ГБ' },
    ]);
    expect(settings.sourceHeaders).toEqual(originalHeaders);
  });
  it('follows reordered columns by header name and reports moves and new columns', () => {
    const headers = ['  артикул ', 'Цена', 'Название', 'Ед.', 'RAM, ГБ', 'Дата', 'НДС', 'Регион'];
    const { profile, report } = applySavedSettings(settings, 'v', headers, 'CSV');
    expect(profile.mapping).toEqual({
      name: 2,
      sku: 0,
      unit: 3,
      unitPrice: 1,
      priceDate: 5,
      taxRate: 6,
    });
    expect(profile.attributes).toEqual([{ column: 4, name: 'Память', unit: 'ГБ' }]);
    expect(report.mismatches).toEqual([]);
    expect(report.moved).toContain('Цена: «Цена» — колонка 4 → 2');
    expect(report.added).toEqual(['Регион']);
  });
  it('leaves missing and ambiguous headers unmapped and reports them', () => {
    const headers = ['Название', 'Артикул', 'Цена', 'Цена', 'Дата', 'RAM, ГБ'];
    const { profile, report } = applySavedSettings(settings, 'v', headers, 'CSV');
    expect(profile.mapping.unit).toBeUndefined();
    expect(profile.mapping.unitPrice).toBeUndefined();
    expect(profile.mapping.taxRate).toBeUndefined();
    expect(report.mismatches).toEqual([
      'Единица: колонка «Ед.» не найдена в файле',
      'Цена: заголовок «Цена» встречается в колонках 3, 4 — выберите вручную',
      'НДС, %: колонка «НДС» не найдена в файле',
    ]);
  });
});

describe('saved profile application on upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.products.mockResolvedValue([]);
    mocks.vendor.mockResolvedValue({ id: 'v', archived: false });
    mocks.upsert.mockImplementation(async ({ create }) => {
      mocks.importFind.mockResolvedValue({
        id: 'b2',
        filename: create.filename,
        checksum: create.checksum,
        status: 'draft',
        createdBy: 'u',
        createdAt: new Date(),
        confirmedBy: null,
        confirmedAt: null,
        revisions: [{ ...create.revisions.create, createdAt: new Date() }],
      });
      return { id: 'b2' };
    });
  });
  const reordered = Buffer.from(
    'Артикул;Цена;Название;Ед.;RAM, ГБ;Дата;НДС\nSKU-1;10,5;Сервер;шт;64;01.10.2026;20\n',
  );
  it('resolves the mapping of a second file with reordered columns', async () => {
    mocks.profile.mockResolvedValue(record());
    const draft = await createImport(
      reordered,
      'next.csv',
      { vendorId: 'v', savedProfileId: 'prof-1', savedProfileRevision: 2 },
      'u',
    );
    expect(draft.profileApplication).toMatchObject({
      profileId: 'prof-1',
      profileRevision: 2,
      mismatches: [],
    });
    expect(draft.rows[0].errors).toEqual([]);
    expect(draft.rows[0].normalized).toMatchObject({
      product: { name: 'Сервер', sku: 'SKU-1', attributes: [{ name: 'Память', value: '64' }] },
      offer: { unitPrice: '10.5', priceDate: '2026-10-01', taxRate: '20' },
    });
  });
  it('rejects a stale, foreign-format or archived profile before storing anything', async () => {
    mocks.profile.mockResolvedValue(record());
    await expect(
      createImport(reordered, 'x.csv', { savedProfileId: 'prof-1', savedProfileRevision: 1 }, 'u'),
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      createImport(reordered, 'x.xlsx', { savedProfileId: 'prof-1', savedProfileRevision: 2 }, 'u'),
    ).rejects.toThrow(/CSV/);
    mocks.profile.mockResolvedValue(record({ archived: true }));
    await expect(
      createImport(reordered, 'x.csv', { savedProfileId: 'prof-1', savedProfileRevision: 2 }, 'u'),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});

describe('profile persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.vendor.mockResolvedValue({ id: 'v', archived: false });
    mocks.importFind.mockResolvedValue({
      id: 'b1',
      filename: 'gpl.csv',
      checksum: 'sha',
      status: 'draft',
      createdBy: 'u',
      createdAt: new Date(),
      confirmedBy: null,
      confirmedAt: null,
      revisions: [
        {
          revision: 3,
          createdBy: 'u',
          createdAt: new Date(),
          data: { profile: original, headers: originalHeaders, sheets: ['CSV'], rows: [] },
        },
      ],
    });
    mocks.profileCreate.mockImplementation(async ({ data }) => record({ ...data, revision: 1 }));
  });
  it('creates a profile from the analyzed draft headers, not client-supplied mapping', async () => {
    const saved = await mutateImportProfile(
      { action: 'create', name: ' Основной ', importId: 'b1', mapping: { name: 9 } },
      'actor',
    );
    const data = mocks.profileCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({ vendorId: 'v', name: 'Основной', format: 'csv' });
    expect(data.profile.columns.name).toEqual({ index: 0, header: 'Название' });
    expect(data.createdBy).toBe('actor');
    expect(saved.settings.columns.sku).toEqual({ index: 1, header: 'Артикул' });
  });
  it('maps duplicate names to 409 and stale updates to 409', async () => {
    mocks.profileCreate.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }));
    await expect(
      mutateImportProfile({ action: 'create', name: 'A', importId: 'b1' }, 'u'),
    ).rejects.toMatchObject({ statusCode: 409 });
    mocks.profile.mockResolvedValue(record());
    mocks.profileUpdate.mockResolvedValue({ count: 0 });
    await expect(
      mutateImportProfile({ action: 'archive', id: 'prof-1', revision: 1 }, 'u'),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(mocks.profileUpdate).toHaveBeenCalledWith({
      where: { id: 'prof-1', revision: 1, archived: false },
      data: expect.objectContaining({ archived: true, revision: { increment: 1 } }),
    });
  });
  it('refuses to update a profile from a file of another format', async () => {
    mocks.profile.mockResolvedValue(record({ format: 'xlsx' }));
    await expect(
      mutateImportProfile({ action: 'update', id: 'prof-1', revision: 2, importId: 'b1' }, 'u'),
    ).rejects.toThrow(/того же вендора и формата/);
    expect(mocks.profileUpdate).not.toHaveBeenCalled();
  });
});
