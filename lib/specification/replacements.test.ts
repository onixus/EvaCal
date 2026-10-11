import { describe, expect, it } from 'vitest';
import { productInput } from '../catalog/validation';
import { catalogItem } from '../catalog/snapshot';
import type { Offer, Product } from '../catalog/types';
import type { ProductRelation } from '../catalog/relations';
import { replaceItem, replacementCandidates } from './replacements';
import { parseSpecification } from './validation';

function product(id: string, sku: string, patch: Partial<Product> = {}): Product {
  const p: Product = {
    id,
    revision: 1,
    archived: false,
    vendorId: 'v',
    vendor: { id: 'v', name: 'Вендор', revision: 1, archived: false },
    name: `Сервер ${sku}`,
    sku,
    edition: '',
    kind: 'hardware',
    unit: 'шт.',
    licensing: '',
    attributes: [],
    offers: [],
    ...patch,
  };
  const offer: Offer = {
    id: `${id}-offer`,
    productRevision: p.revision,
    source: 'GPL',
    unitPrice: '100',
    currency: 'USD',
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
      id: p.id,
      revision: p.revision,
      vendor: { id: 'v', name: 'Вендор', revision: 1 },
    },
  };
  return { ...p, offers: [offer] };
}
const relation: ProductRelation = {
  id: 'r1',
  fromProductId: 'new',
  toProductId: 'old',
  type: 'replaces',
  quantity: null,
  note: 'EOL',
  createdBy: 'u',
  createdAt: 'now',
  archivedAt: null,
  archivedBy: null,
};

describe('Явная замена позиции по связи каталога', () => {
  const oldProduct = product('old', 'OLD-1');
  const newProduct = product('new', 'NEW-2');
  const row = {
    ...catalogItem(oldProduct, oldProduct.offers[0], 'row-1'),
    quantity: '4',
    rationale: 'Сайзинг v1',
    confirmed: true,
  };
  it('предпросмотр находит строки, ссылающиеся на замененную позицию (в т.ч. архивную)', () => {
    const archivedOld = { ...oldProduct, archived: true };
    const candidates = replacementCandidates(
      { items: [row, { ...row, id: 'manual', origin: undefined }] },
      [archivedOld, newProduct],
      [relation, { ...relation, id: 'r2', archivedAt: 'x', archivedBy: 'u' }],
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      itemId: 'row-1',
      productArchived: true,
      options: [{ relationId: 'r1', productId: 'new', offers: [{ id: 'new-offer' }] }],
    });
  });
  it('замена сохраняет ID, количество и основание, снимает подтверждение и пишет причину', () => {
    const replaced = replaceItem(row, newProduct, newProduct.offers[0], relation);
    expect(replaced).toMatchObject({
      id: 'row-1',
      sku: 'NEW-2',
      quantity: '4',
      rationale: 'Сайзинг v1',
      confirmed: false,
      unitPrice: '100',
      origin: { productId: 'new', offerId: 'new-offer' },
    });
    expect(replaced.changeReason).toMatch(/OLD-1 → Вендор NEW-2 \(EOL\)/);
    expect(() =>
      parseSpecification({ version: 1, status: 'draft', emptySupplyReason: '', items: [replaced] }),
    ).not.toThrow();
  });
  it('связь с сайзингом сохраняется вместе с количеством', () => {
    const sizingRef = { runId: 'run-1', metric: 'nodes', requiredQuantity: '4' };
    expect(
      replaceItem({ ...row, sizingRef }, newProduct, newProduct.offers[0], relation).sizingRef,
    ).toEqual(sizingRef);
  });
  it('архивная замена не применяется', () => {
    expect(() => replaceItem(row, { ...newProduct, archived: true }, undefined, relation)).toThrow(
      /архивированы/,
    );
  });
});
