import { describe, it, expect } from 'vitest';
import { productInput, offerInput } from './validation';
import { catalogItem } from './snapshot';
import { parseSpecification } from '../specification/validation';
import type { Product, Offer } from './types';
const offer: Offer = {
  id: 'o1',
  productRevision: 1,
  source: 'Ручной прайс',
  unitPrice: '123.000001',
  currency: 'USD',
  region: 'TR',
  terms: '12 месяцев',
  priceDate: null,
  validUntil: null,
  createdBy: 'u',
  createdAt: '2026-10-10',
};
const product: Product = {
  id: 'p',
  revision: 1,
  archived: false,
  vendorId: 'v',
  vendor: { id: 'v', name: 'Новый вендор', revision: 1, archived: false },
  name: 'Подписка',
  sku: 'same-sku',
  edition: 'Plus',
  kind: 'license',
  unit: 'узел',
  licensing: 'На узел',
  attributes: [{ name: 'EPS', value: '1000', unit: 'событий/с' }],
  offers: [offer],
};
describe('Каталог и проектные копии', () => {
  it('новые вендоры и произвольные атрибуты не требуют статического справочника', () => {
    expect(productInput(product).attributes[0].name).toBe('EPS');
    expect(() =>
      productInput({
        ...product,
        attributes: [
          { name: 'EPS', value: '1', unit: '' },
          { name: 'eps', value: '2', unit: '' },
        ],
      }),
    ).toThrow();
  });
  it('цена не проходит через binary float; неизвестно отличается от нуля', () => {
    expect(offerInput(offer).unitPrice).toBe('123.000001');
    expect(offerInput({ ...offer, unitPrice: '0' }).unitPrice).toBe('0');
    expect(offerInput({ ...offer, unitPrice: null }).unitPrice).toBeNull();
    for (const unitPrice of [12.3, '-1', '1e3', '1234567890123', '0.0000001'])
      expect(() => offerInput({ ...offer, unitPrice })).toThrow();
  });
  it('даты не получают неявную актуальность и проверяются календарно', () => {
    expect(offerInput(offer).priceDate).toBeNull();
    for (const priceDate of ['2026-02-30', 'yesterday', '2026-13-01'])
      expect(() => offerInput({ ...offer, priceDate })).toThrow();
    expect(() =>
      offerInput({ ...offer, priceDate: '2026-10-10', validUntil: '2026-10-09' }),
    ).toThrow();
  });
  it('проект сохраняет значения, provenance и требует подтверждения', () => {
    const item = catalogItem(product, offer, 'i1');
    const saved = parseSpecification({
      version: 0,
      status: 'draft',
      emptySupplyReason: '',
      items: [item],
    });
    expect(saved.items[0].unitPrice).toBe('123.000001');
    expect(item.quantity).toBeNull();
    expect(item.confirmed).toBe(false);
    expect(item.source).toContain('o1');
    expect(item.source).toContain('дата цены неизвестна');
    const changed = { ...product, name: 'Новая позиция', attributes: [], revision: 2 };
    expect(() => catalogItem(changed, offer)).toThrow('предыдущей редакции');
    expect(saved.items[0].name).toBe('Подписка');
    expect(saved.items[0].configuration).toContain('EPS: 1000');
  });
  it('архив и чужая цена исключены; без цены можно заполнить вручную', () => {
    expect(() => catalogItem({ ...product, archived: true })).toThrow();
    expect(() =>
      catalogItem({ ...product, vendor: { ...product.vendor, archived: true } }),
    ).toThrow();
    expect(() => catalogItem(product, { ...offer, id: 'foreign' })).toThrow();
    expect(catalogItem(product).unitPrice).toBeNull();
  });
});
