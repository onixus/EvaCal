import { describe, expect, it } from 'vitest';
import { addDecimal, buildSupply, mulDecimal, type CostItemInput } from '@/lib/supply';
import { calculateCommercialSummary } from '@/lib/commercial';
import { parsePriceSplit, parseSpecification } from '@/lib/specification/validation';
import type { SpecificationItem } from '@/lib/specification/types';

const item = (over: Partial<SpecificationItem>): SpecificationItem => ({
  id: over.id ?? 'i1',
  kind: 'hardware',
  disposition: 'supply',
  name: over.name ?? 'Сервер',
  vendor: 'V',
  sku: 'S',
  quantity: '2',
  unit: 'шт',
  configuration: '',
  licensing: '',
  term: '',
  source: 'КП поставщика',
  rationale: '',
  confirmed: true,
  unitPrice: '100.10',
  currency: 'RUB',
  ...over,
});

const cost = (over: Partial<CostItemInput>): CostItemInput => ({
  id: over.id ?? 'c1',
  kind: 'subcontractor',
  description: over.description ?? 'Монтаж',
  quantity: '1',
  unitCost: '1000',
  currency: 'RUB',
  exchangeRate: null,
  exchangeRateDate: null,
  exchangeRateSource: null,
  specItemRef: null,
  order: 0,
  ...over,
});

const base = { currency: 'RUB', vatPercent: 20, includeVat: true };

describe('decimal helpers', () => {
  it('точное умножение без ошибок плавающей точки', () => {
    expect(mulDecimal('0.1', '3')).toBe('0.3');
    expect(addDecimal('0.1', '0.2')).toBe('0.3');
    expect(mulDecimal('1.005', '1000')).toBe('1005');
    expect(mulDecimal('0.000001', '0.000001')).toBe('0.000000000001');
  });
});

describe('buildSupply', () => {
  it('цена = кол-во × (salePrice ?? unitPrice) × (1 − скидка), НДС строки, округление только в итоге', () => {
    const s = buildSupply({
      ...base,
      specification: {
        version: 2,
        items: [
          item({ purchasePrice: '80', discountPercent: '10' }),
          item({
            id: 'i2',
            quantity: '3',
            unitPrice: '0.333333',
            salePrice: '0.335',
            vatRate: '0',
            purchasePrice: '0.3',
          }),
        ],
      },
      costItems: [],
    });
    expect(s.lines[0].sale).toBe('180.18');
    expect(s.lines[1].sale).toBe('1.005');
    expect(s.supplyPrice).toBe(181.19); // 181.185 → half-up
    expect(s.supplyCost).toBe(160.9);
    expect(s.supplyVat).toBe(36.04); // 180.18 × 20% + 1.005 × 0%
    expect(s.incomplete).toBe(false);
  });

  it('неизвестная цена и себестоимость — неполная сумма, а не 0', () => {
    const s = buildSupply({
      ...base,
      specification: { version: 1, items: [item({ unitPrice: null }), item({ id: 'i2' })] },
      costItems: [],
    });
    expect(s.lines[0].sale).toBeNull();
    expect(s.incomplete).toBe(true);
    expect(s.problems.join(' ')).toContain('цена неизвестна');
    expect(s.problems.join(' ')).toContain('себестоимость неизвестна');
    expect(s.supplyPrice).toBe(200.2);
  });

  it('пересчёт валюты только по курсу из снимка; без курса — неполно, курс 1 не подразумевается', () => {
    const usd = item({ currency: 'USD', unitPrice: '10', purchasePrice: '8' });
    const without = buildSupply({
      ...base,
      specification: { version: 1, items: [usd] },
      costItems: [],
    });
    expect(without.lines[0].sale).toBeNull();
    expect(without.lines[0].saleOriginal).toBe('20');
    expect(without.supplyPrice).toBe(0);
    expect(without.incomplete).toBe(true);
    expect(without.problems[0]).toContain('нет курса USD→RUB');

    const withRate = buildSupply({
      ...base,
      specification: {
        version: 1,
        items: [usd],
        exchangeRates: [
          { from: 'USD', to: 'RUB', rate: '92.12345678', date: '2026-10-01', source: 'ЦБ РФ' },
        ],
      },
      costItems: [],
    });
    expect(withRate.lines[0].sale).toBe('1842.4691356');
    expect(withRate.lines[0].cost).toBe('1473.97530848');
    expect(withRate.lines[0].rate).toEqual({
      rate: '92.12345678',
      date: '2026-10-01',
      source: 'ЦБ РФ',
    });
    expect(withRate.lines[0].explanation).toContain('курс 92.12345678 (2026-10-01, ЦБ РФ)');
    expect(withRate.supplyPrice).toBe(1842.47);
    expect(withRate.incomplete).toBe(false);
  });

  it('без двойного учёта: связанная статья — себестоимость строки, не наценяемая статья', () => {
    const s = buildSupply({
      ...base,
      specification: { version: 1, items: [item({ purchasePrice: '80' })] },
      costItems: [
        cost({ id: 'linked', unitCost: '150', specItemRef: 'i1' }),
        cost({ id: 'free', unitCost: '500' }),
      ],
    });
    expect(s.lines[0].costSource).toBe('cost_items');
    expect(s.lines[0].cost).toBe('150');
    expect(s.supplyCost).toBe(150);
    expect(s.costItemsCost).toBe(500);
    expect(s.costItems.map((c) => c.state)).toEqual(['linked', 'standalone']);
  });

  it('компоненты комплекта и не-поставка не суммируются; статья на такую строку — неполные данные', () => {
    const s = buildSupply({
      ...base,
      specification: {
        version: 1,
        items: [
          item({ id: 'b', kind: 'bundle', unitPrice: '1000', quantity: '1', purchasePrice: '700' }),
          item({ id: 'part', purchasePrice: '1', includedIn: 'b', perBundle: '2' }),
          item({ id: 'old', disposition: 'existing' }),
        ],
      },
      costItems: [cost({ specItemRef: 'part' })],
    });
    expect(s.lines.map((l) => l.ref)).toEqual(['b']);
    expect(s.supplyPrice).toBe(1000);
    expect(s.supplyCost).toBe(700);
    expect(s.costItems[0].state).toBe('orphan');
    expect(s.costItems[0].problems[0]).toContain('компонент комплекта');
    expect(s.costItemsCost).toBe(0);
    expect(s.incomplete).toBe(true);
  });

  it('статья в другой валюте требует курса в самой статье', () => {
    const s = buildSupply({
      ...base,
      specification: null,
      costItems: [
        cost({ currency: 'EUR', unitCost: '10' }),
        cost({
          id: 'c2',
          currency: 'EUR',
          unitCost: '10',
          exchangeRate: '100.5',
          exchangeRateDate: '2026-10-01',
          exchangeRateSource: 'договор',
        }),
        cost({ id: 'c3', unitCost: null }),
      ],
    });
    expect(s.costItems.map((c) => c.amount)).toEqual([null, '1005', null]);
    expect(s.costItemsCost).toBe(1005);
    expect(s.problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining('нет курса EUR→RUB'),
        expect.stringContaining('стоимость неизвестна'),
      ]),
    );
  });
});

describe('calculateCommercialSummary с поставкой', () => {
  const stages = [{ hours: 10, role: 'developer' }];
  const terms = {
    currency: 'RUB',
    pricingMode: 'markup',
    roleRates: '{"developer":1000}',
    marginPercent: 20,
    overheadPercent: 10,
    discountPercent: 5,
    vatPercent: 20,
  };

  it('исторический КП без поставки воспроизводится: итог равен услугам, прежние поля не меняются', () => {
    for (const pricingMode of ['legacy_markup', 'markup', 'target_margin']) {
      const before = calculateCommercialSummary(stages, 4, [{ hours: 2 }], {
        ...terms,
        pricingMode,
      });
      const withNull = calculateCommercialSummary(stages, 4, [{ hours: 2 }], {
        ...terms,
        pricingMode,
        supply: null,
      });
      expect(withNull).toEqual(before);
      expect(before.total).toEqual({
        cost: before.totalCost,
        priceExVat: before.subtotalExVat,
        vat: before.vatAmount,
        grandTotal: before.grandTotal,
        profit: before.profitAfterDiscount,
        marginPercent: before.effectiveMarginPercent,
        incomplete: false,
      });
      expect(before.costItemsCost).toBe(0);
    }
    // Числа исторического legacy-КП: 10 ч × 1000 + накладные 10% = 11000; +20% → 13200; −5%.
    const legacy = calculateCommercialSummary(stages, 0, [], {
      ...terms,
      pricingMode: 'legacy_markup',
    });
    expect(legacy.totalCost).toBe(11000);
    expect(legacy.grandTotal).toBe(15048);
  });

  it('отдельные статьи наценяются с услугами, поставка добавляется по своей цене', () => {
    const supply = buildSupply({
      currency: 'RUB',
      vatPercent: 20,
      includeVat: true,
      specification: {
        version: 1,
        items: [item({ unitPrice: '500', quantity: '1', purchasePrice: '400' })],
      },
      costItems: [cost({ unitCost: '1000' })],
    });
    const s = calculateCommercialSummary(stages, 0, [], { ...terms, supply });
    expect(s.costItemsCost).toBe(1000);
    expect(s.totalCost).toBe(12000); // 10000 + 1000 накладные + 1000 статья
    expect(s.subtotalExVat).toBe(13680); // 12000 × 1.2 × 0.95
    expect(s.total.priceExVat).toBe(14180);
    expect(s.total.cost).toBe(12400);
    expect(s.total.profit).toBe(1780);
    expect(s.total.vat).toBe(2836);
    expect(s.total.grandTotal).toBe(17016);
    expect(s.total.marginPercent).toBeCloseTo(12.553, 3);
    expect(s.total.incomplete).toBe(false);
  });
});

describe('price split validation', () => {
  it('поля необязательны; пустые значения опускаются; проценты 0–100', () => {
    expect(parsePriceSplit({})).toEqual({});
    expect(parsePriceSplit({ purchasePrice: '', salePrice: null })).toEqual({});
    expect(
      parsePriceSplit({ purchasePrice: '1.5', discountPercent: '12.5', vatRate: '0' }),
    ).toEqual({
      purchasePrice: '1.5',
      discountPercent: '12.5',
      vatRate: '0',
    });
    expect(() => parsePriceSplit({ discountPercent: '101' })).toThrow();
    expect(() => parsePriceSplit({ salePrice: '-1' })).toThrow();
    expect(() => parsePriceSplit({ vatRate: 20 })).toThrow();
  });

  it('снимок хранит курсы с датой и источником; без источника или с курсом 0 — ошибка', () => {
    const snap = {
      version: 1,
      status: 'draft',
      emptySupplyReason: '',
      items: [],
    };
    const ok = parseSpecification({
      ...snap,
      exchangeRates: [
        { from: 'USD', to: 'RUB', rate: '92.5', date: '2026-10-01', source: 'ЦБ РФ' },
      ],
    });
    expect(ok.exchangeRates).toEqual([
      { from: 'USD', to: 'RUB', rate: '92.5', date: '2026-10-01', source: 'ЦБ РФ' },
    ]);
    expect(parseSpecification(snap)).not.toHaveProperty('exchangeRates');
    for (const bad of [
      { from: 'USD', to: 'RUB', rate: '0', date: '2026-10-01', source: 'ЦБ' },
      { from: 'USD', to: 'RUB', rate: '1', date: '2026-10-01', source: ' ' },
      { from: 'USD', to: 'USD', rate: '1', date: '2026-10-01', source: 'x' },
      { from: 'USD', to: 'RUB', rate: '1.123456789', date: '2026-10-01', source: 'x' },
    ]) {
      expect(() => parseSpecification({ ...snap, exchangeRates: [bad] })).toThrow();
    }
  });
});
