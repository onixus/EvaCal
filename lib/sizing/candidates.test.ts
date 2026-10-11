import { describe, expect, it } from 'vitest';
import { capacityValue, proposeCatalogCandidates, type CandidateMetric } from './candidates';
import type { Offer, Product } from '../catalog/types';
import type { AttributeDefinition } from '../catalog/attributes';
import { parseSpecification } from '../specification/validation';

const vendor = (id: string, archived = false) => ({
  id,
  name: `Вендор ${id}`,
  revision: 1,
  archived,
});
function product(
  id: string,
  attributes: Product['attributes'],
  offers: Array<Partial<Offer>> = [],
  over: Partial<Product> = {},
): Product {
  const base = {
    id,
    vendorId: 'v1',
    vendor: vendor('v1'),
    revision: 1,
    archived: false,
    name: `Узел ${id}`,
    sku: `SKU-${id}`,
    edition: '',
    kind: 'hardware' as const,
    unit: 'шт.',
    licensing: '',
    attributes,
    ...over,
  };
  return {
    ...base,
    offers: offers.map((o, index) => ({
      id: `${id}-o${index}`,
      source: `GPL ${id}`,
      unitPrice: '100',
      currency: 'RUB',
      region: '',
      terms: '',
      priceDate: '2026-10-01',
      validUntil: null,
      productRevision: base.revision,
      productSnapshot: {
        id,
        revision: base.revision,
        vendorId: base.vendorId,
        vendor: { id: base.vendor.id, name: base.vendor.name, revision: 1 },
        name: base.name,
        sku: base.sku,
        edition: base.edition,
        kind: base.kind,
        unit: base.unit,
        licensing: base.licensing,
        attributes: base.attributes,
      },
      confirmationStatus: 'confirmed',
      confirmedBy: 'u',
      confirmedAt: '2026-10-01',
      createdAt: '2026-10-01',
      createdBy: 'u',
      ...o,
    })) as Offer[],
  };
}
const metric: CandidateMetric = {
  key: 'eps',
  label: 'Поток событий',
  unit: 'EPS',
  required: '12000',
  scenario: 'base',
};
const run = { id: 'run-1', label: 'SIEM v1, прогон 2026-10-11 10:00' };
const propose = (
  products: Product[],
  over: Partial<CandidateMetric> = {},
  definitions: AttributeDefinition[] = [],
) =>
  proposeCatalogCandidates({
    products,
    definitions,
    metric: { ...metric, ...over },
    run,
    today: '2026-10-11',
  });

describe('подбор кандидатов каталога по метрике сайзинга', () => {
  it('ёмкость характеристики: положительное число', () => {
    expect(capacityValue('5 000')).toBe('5000');
    expect(capacityValue('2,50')).toBe('2.5');
    expect(capacityValue('007')).toBe('7');
    expect(capacityValue('0')).toBeNull();
    expect(capacityValue('-1')).toBeNull();
    expect(capacityValue('много')).toBeNull();
    expect(capacityValue('1.1234567')).toBeNull();
  });

  it('количество = ceil(потребность / ёмкость), стоимость точная, несколько альтернатив по цене', () => {
    const result = propose([
      product('a', [{ name: 'EPS', value: '5000', unit: 'EPS' }], [{ unitPrice: '1000.10' }]),
      product('b', [{ name: 'eps', value: '10000', unit: 'eps' }], [{ unitPrice: '1500' }]),
      product('c', [{ name: 'Поток событий', value: '3000', unit: '' }], [{ unitPrice: '700' }]),
    ]);
    expect(result.candidates.map((c) => [c.productId, c.quantity, c.amount, c.surplus])).toEqual([
      ['c', '4', '2800', '0'],
      ['b', '2', '3000', '8000'],
      ['a', '3', '3000.3', '3000'],
    ]);
    const cheapest = result.candidates[0];
    expect(cheapest.productId).toBe('c');
    expect(cheapest.item).toMatchObject({
      quantity: '4',
      confirmed: false,
      unitPrice: '700',
      sizingRef: { runId: 'run-1', metric: 'eps', requiredQuantity: '12000', unitCapacity: '3000' },
    });
    expect(cheapest.item.rationale).toContain('Поток событий = 3000 на единицу → 4 шт.');
    // Строка готова к обычному сохранению: проходит строгую валидацию снимка.
    expect(() =>
      parseSpecification({
        version: 0,
        status: 'draft',
        emptySupplyReason: '',
        items: [cheapest.item],
      }),
    ).not.toThrow();
  });

  it('без подтвержденной действующей цены стоимость неизвестна и кандидат ниже известных', () => {
    const result = propose([
      product(
        'unconfirmed',
        [{ name: 'eps', value: '20000', unit: 'EPS' }],
        [{ confirmationStatus: 'unconfirmed', unitPrice: '1' }],
      ),
      product(
        'expired',
        [{ name: 'eps', value: '20000', unit: 'EPS' }],
        [{ validUntil: '2026-10-10', unitPrice: '1' }],
      ),
      product(
        'stale',
        [{ name: 'eps', value: '20000', unit: 'EPS' }],
        [{ productRevision: 0, unitPrice: '1' }],
      ),
      product('none', [{ name: 'eps', value: '20000', unit: 'EPS' }]),
      product('priced', [{ name: 'eps', value: '1000', unit: 'EPS' }], [{ unitPrice: '999999' }]),
    ]);
    expect(result.candidates[0].productId).toBe('priced');
    for (const c of result.candidates.slice(1)) {
      expect(c.unitPrice).toBeNull();
      expect(c.amount).toBeNull();
      expect(c.offerId).toBeNull();
      expect(c.item.unitPrice).toBeNull();
      expect(c.quantity).toBe('1');
    }
    expect(result.candidates).toHaveLength(5);
  });

  it('каждое подтвержденное предложение — отдельная альтернатива', () => {
    const result = propose([
      product(
        'a',
        [{ name: 'eps', value: '12000', unit: 'EPS' }],
        [
          { unitPrice: '10', source: 'GPL-1' },
          { unitPrice: '5', source: 'GPL-2', currency: 'USD' },
        ],
      ),
    ]);
    expect(result.candidates.map((c) => [c.offerId, c.currency, c.amount])).toEqual([
      ['a-o0', 'RUB', '10'],
      ['a-o1', 'USD', '5'],
    ]);
  });

  it('несовместимая единица, нечисловое значение, архив и отсутствие характеристики', () => {
    const result = propose([
      product('gbps', [{ name: 'eps', value: '1', unit: 'Гбит/с' }]),
      product('text', [{ name: 'eps', value: 'до 5000', unit: 'EPS' }]),
      product('archived', [{ name: 'eps', value: '1', unit: 'EPS' }], [], { archived: true }),
      product('vendor', [{ name: 'eps', value: '1', unit: 'EPS' }], [], {
        vendor: vendor('v2', true),
      }),
      product('other', [{ name: 'RAM', value: '64', unit: 'ГБ' }]),
    ]);
    expect(result.candidates).toEqual([]);
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped[0]).toContain('единица «Гбит/с»');
    expect(result.skipped[1]).toContain('не положительное число');
  });

  it('совпадение через определение характеристики и сценарий, лимит выдачи', () => {
    const definitions: AttributeDefinition[] = [
      {
        id: 'd1',
        key: 'nodes',
        label: 'Узлов в комплекте',
        valueType: 'number',
        unit: 'шт.',
        allowedUnits: null,
        enumValues: null,
        archived: false,
        revision: 1,
      },
    ];
    const products = Array.from({ length: 25 }, (_, i) =>
      product(
        `p${i}`,
        [{ name: 'Узлов в комплекте', value: '2', unit: '' }],
        [{ unitPrice: String(100 + i) }],
      ),
    );
    const result = propose(
      products,
      { key: 'nodes', label: 'Узлы', unit: 'шт', required: '3', scenario: 'ha' },
      definitions,
    );
    expect(result.candidates).toHaveLength(20);
    expect(result.candidates[0]).toMatchObject({ productId: 'p0', quantity: '2', amount: '200' });
    expect(result.candidates[0].item.sizingRef).toEqual({
      runId: 'run-1',
      metric: 'nodes',
      scenario: 'ha',
      requiredQuantity: '3',
      unitCapacity: '2',
    });
  });
});
