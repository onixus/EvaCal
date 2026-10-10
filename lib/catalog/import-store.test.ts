import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  batch: vi.fn(),
  products: vi.fn(),
  query: vi.fn(),
  offer: vi.fn(),
  revision: vi.fn(),
  update: vi.fn(),
  load: vi.fn(),
}));
vi.mock('../prisma', () => ({
  prisma: { $transaction: mocks.transaction, catalogImport: { findUnique: mocks.load } },
}));
import { mutateImport } from './import-store';
const technical = {
  vendorId: 'v',
  name: 'A',
  sku: 'A',
  edition: '',
  kind: 'hardware',
  unit: 'шт',
  licensing: '',
  attributes: [],
};
const offer = {
  source: 'GPL',
  unitPrice: '1',
  currency: 'RUB',
  region: '',
  terms: '',
  priceDate: null,
  validUntil: null,
};
const row = {
  id: 'GPL:2',
  sheet: 'GPL',
  rowNumber: 2,
  raw: ['A', 'A', 'шт', '1'],
  normalized: { product: technical, offer },
  errors: [],
  status: 'ready',
};
const batch = {
  id: 'b',
  revision: 1,
  status: 'draft',
  vendorId: 'v',
  filename: 'x.csv',
  checksum: 'sha',
  createdBy: 'u',
  createdAt: new Date(),
  confirmedBy: null,
  confirmedAt: null,
  revisions: [
    {
      revision: 1,
      createdBy: 'u',
      createdAt: new Date(),
      data: { profile: { vendorId: 'v' }, sheets: ['GPL'], headers: [], rows: [row] },
    },
  ],
};
const product = { ...technical, id: 'p', revision: 1, archived: false };
describe('GPL technical changes of existing products', () => {
  const changedRow = {
    ...row,
    normalized: {
      product: {
        ...technical,
        attributes: [{ name: 'Производитель', value: 'Yadro', unit: '' }],
      },
      offer,
    },
    technicalChange: {
      productId: 'p',
      productRevision: 1,
      changes: [{ field: 'attributes', before: '', after: 'Производитель: Yadro' }],
    },
  };
  const changedBatch = {
    ...batch,
    revisions: [
      { ...batch.revisions[0], data: { ...batch.revisions[0].data, rows: [changedRow] } },
    ],
  };
  const productUpdate = vi.fn();
  const productFind = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.batch.mockResolvedValue(changedBatch);
    mocks.load.mockResolvedValue(changedBatch);
    mocks.products.mockResolvedValue([product]);
    mocks.query.mockResolvedValue([{ id: 'v', name: 'Vendor', revision: 1, archived: false }]);
    productUpdate.mockResolvedValue({ count: 1 });
    productFind.mockResolvedValue({ ...product, ...changedRow.normalized.product, revision: 2 });
    mocks.transaction.mockImplementation(async (fn) =>
      fn({
        $queryRaw: mocks.query,
        catalogImport: { findUnique: mocks.batch, update: mocks.update },
        catalogProduct: {
          findMany: mocks.products,
          updateMany: productUpdate,
          findUniqueOrThrow: productFind,
        },
        catalogOffer: { create: mocks.offer },
        catalogImportRevision: { create: mocks.revision },
      }),
    );
  });
  it('a newly mapped attribute is not a hard error but requires explicit acceptance', async () => {
    await expect(
      mutateImport('b', { action: 'confirm', revision: 1, rowIds: ['GPL:2'] }, 'u'),
    ).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/примите их явно/) });
    expect(productUpdate).not.toHaveBeenCalled();
    expect(mocks.offer).not.toHaveBeenCalled();
  });
  it('accepted change creates a new product revision and prices it', async () => {
    await mutateImport(
      'b',
      { action: 'confirm', revision: 1, rowIds: ['GPL:2'], acceptTechnicalChanges: ['GPL:2'] },
      'u',
    );
    expect(productUpdate).toHaveBeenCalledWith({
      where: { id: 'p', revision: 1, archived: false },
      data: expect.objectContaining({ revision: { increment: 1 } }),
    });
    expect(mocks.offer.mock.calls[0][0].data).toMatchObject({
      productRevision: 2,
      productSnapshot: { revision: 2, attributes: [{ name: 'Производитель', value: 'Yadro' }] },
    });
  });
  it('rejects acceptance reviewed against an older product revision', async () => {
    mocks.products.mockResolvedValue([{ ...product, revision: 3 }]);
    await expect(
      mutateImport(
        'b',
        { action: 'confirm', revision: 1, rowIds: ['GPL:2'], acceptTechnicalChanges: ['GPL:2'] },
        'u',
      ),
    ).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/изменилась/) });
    expect(productUpdate).not.toHaveBeenCalled();
  });
  it('acceptance is limited to selected rows', async () => {
    await expect(
      mutateImport(
        'b',
        { action: 'confirm', revision: 1, rowIds: ['GPL:2'], acceptTechnicalChanges: ['other'] },
        'u',
      ),
    ).rejects.toThrow(/выбранных строк/);
  });
});
describe('GPL confirmation locks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.batch.mockResolvedValue(batch);
    mocks.load.mockResolvedValue(batch);
    mocks.query.mockResolvedValue([{ id: 'v', name: 'Vendor', revision: 1, archived: false }]);
    mocks.transaction.mockImplementation(async (fn) =>
      fn({
        $queryRaw: mocks.query,
        catalogImport: { findUnique: mocks.batch, update: mocks.update },
        catalogProduct: { findMany: mocks.products },
        catalogOffer: { create: mocks.offer },
        catalogImportRevision: { create: mocks.revision },
      }),
    );
  });
  it('rejects a newly appeared matching product before acquiring an offer FK lock or writing history', async () => {
    mocks.products.mockResolvedValueOnce([]).mockResolvedValueOnce([product]);
    await expect(
      mutateImport('b', { action: 'confirm', revision: 1, rowIds: ['GPL:2'] }, 'u'),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(mocks.offer).not.toHaveBeenCalled();
    expect(mocks.revision).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.query).toHaveBeenCalledTimes(2); // Batch then Vendor; no late Product lock.
  });
  it('allows a retry when the product exists in the initially locked set', async () => {
    mocks.products.mockResolvedValueOnce([product]).mockResolvedValueOnce([product]);
    await mutateImport('b', { action: 'confirm', revision: 1, rowIds: ['GPL:2'] }, 'u');
    expect(mocks.offer).toHaveBeenCalledOnce();
    // The explicit GPL confirmation is recorded as the offer confirmation.
    expect(mocks.offer.mock.calls[0][0].data).toMatchObject({
      confirmationStatus: 'confirmed',
      confirmedBy: 'u',
      confirmedAt: expect.any(Date),
    });
    expect(mocks.revision).toHaveBeenCalledOnce();
    const sql = mocks.query.mock.calls.map((args) => args[0].join(''));
    expect(sql[1]).toContain('CatalogProduct');
    expect(sql[2]).toContain('CatalogVendor');
  });
});
