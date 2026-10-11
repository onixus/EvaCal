import { describe, expect, it } from 'vitest';
import { calculateCommercialSummary } from '@/lib/commercial';
import {
  compareOffers,
  isOfferError,
  offerTerm,
  type OfferVariant,
  type OfferVersionInput,
} from '@/lib/offerCompare';
import type { SpecificationItem } from '@/lib/specification/types';

const item = (over: Partial<SpecificationItem>): SpecificationItem => ({
  id: over.id ?? 'i1',
  kind: 'hardware',
  disposition: 'supply',
  name: 'Сервер',
  vendor: 'V',
  sku: 'S',
  quantity: '2',
  unit: 'шт',
  configuration: '',
  licensing: '',
  term: '',
  source: '',
  rationale: '',
  confirmed: true,
  unitPrice: '100.5',
  currency: 'RUB',
  ...over,
});

function version(over: Partial<OfferVersionInput> = {}): OfferVersionInput {
  return {
    id: 'c1',
    version: 1,
    name: 'КП',
    status: 'approved',
    versionComment: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    startDate: '2026-11-02T00:00:00.000Z',
    pmHours: 10,
    terms: {
      currency: 'RUB',
      pricingMode: 'markup',
      roleRates: '{"developer":1000,"analyst":2000,"pm":1500}',
      overheadPercent: 10,
      marginPercent: 20,
      discountPercent: 5,
      vatPercent: 20,
      includeVat: true,
    },
    stages: [
      {
        name: 'Анализ',
        role: 'analyst',
        hours: 20,
        isApprovalTask: false,
        startDate: '2026-11-02T00:00:00.000Z',
        endDate: '2026-11-06T00:00:00.000Z',
      },
      {
        name: 'Разработка',
        role: 'developer',
        hours: 100,
        isApprovalTask: false,
        startDate: '2026-11-09T00:00:00.000Z',
        endDate: '2026-11-27T00:00:00.000Z',
      },
      {
        name: 'Согласование: Разработка',
        role: 'customer',
        hours: 0,
        isApprovalTask: true,
        startDate: '2026-11-30T00:00:00.000Z',
        endDate: '2026-12-02T00:00:00.000Z',
      },
    ],
    risks: [{ description: 'Интеграция', hours: 8 }],
    specification: null,
    latestSpecification: null,
    ...over,
  };
}

/** Сравнение, где все версии пересчитаны (иначе тест падает с текстом ошибки). */
function cmp(inputs: OfferVersionInput[]) {
  const result = compareOffers(inputs);
  const variants: OfferVariant[] = result.variants.map((v) => {
    if (isOfferError(v)) throw new Error(v.error);
    return v;
  });
  return { ...result, variants };
}

describe('compareOffers', () => {
  it('цифры варианта совпадают с КП по сохранённым условиям версии', () => {
    const v = version();
    const [variant] = cmp([v, version({ id: 'c2', version: 2 })]).variants;
    const summary = calculateCommercialSummary(v.stages, v.pmHours, v.risks, v.terms);
    expect(variant.money.totalCost).toBe(summary.totalCost);
    expect(variant.money.subtotalExVat).toBe(summary.subtotalExVat);
    expect(variant.money.profit).toBe(summary.profitAfterDiscount);
    expect(variant.composition).toMatchObject({
      stageCount: 2,
      stageHours: 120,
      pmHours: 10,
      riskHours: 8,
      totalHours: 138,
    });
    expect(variant.rates.find((r) => r.role === 'developer')?.rate).toBe(1000);
    expect(variant.ratesCoverage).toBe('stored');
    expect(variant.explain.cost).toContain('Ставки — сохранённые в версии');
    expect(variant.explain.price).toContain('наценка 20%');
    expect(variant.explain.profit).toContain('Прибыль = цена без НДС');
  });

  it('исторические ставки версии сохраняются: новая версия с другими ставками не меняет старую', () => {
    const v1 = version();
    const before = cmp([v1, version({ id: 'x', version: 9 })]).variants[0];
    const v2 = version({
      id: 'c2',
      version: 2,
      terms: { ...v1.terms, roleRates: '{"developer":5000,"analyst":6000,"pm":7000}' },
    });
    const result = cmp([v1, v2]);
    expect(result.variants[0].money).toEqual(before.money);
    expect(result.variants[1].money.totalCost).toBeGreaterThan(before.money.totalCost);
    expect(result.variants[1].delta?.totalCost).toBe(
      Math.round((result.variants[1].money.totalCost - before.money.totalCost) * 100) / 100,
    );
    expect(result.variants[1].delta?.totalHours).toBe(0);
  });

  it('без сохранённых ставок вариант явно помечен', () => {
    const v = version({ terms: { ...version().terms, roleRates: null } });
    const [variant] = cmp([v, version({ id: 'c2' })]).variants;
    expect(variant.ratesCoverage).toBe('default');
    expect(variant.explain.cost).toContain('ставки по умолчанию');
  });

  it('target_margin объясняется делением на (1 − маржа)', () => {
    const v = version({ terms: { ...version().terms, pricingMode: 'target_margin' } });
    const [variant] = cmp([v, version({ id: 'c2' })]).variants;
    expect(variant.explain.price).toContain('/ (1 − 20%)');
  });

  it('срок — по сохранённым датам Ганта, включая согласования', () => {
    const term = offerTerm(version().stages);
    expect(term).toEqual({ start: '2026-11-02', end: '2026-12-02', calendarDays: 31 });
    expect(offerTerm([])).toBeNull();
  });

  it('разница состава по этапам', () => {
    const base = version();
    const next = version({
      id: 'c2',
      stages: [
        { ...base.stages[1], hours: 140 },
        {
          name: 'Внедрение',
          role: 'engineer',
          hours: 16,
          isApprovalTask: false,
          startDate: '2026-11-30T00:00:00.000Z',
          endDate: '2026-12-10T00:00:00.000Z',
        },
      ],
    });
    const delta = cmp([base, next]).variants[1].delta!;
    expect(delta.stagesAdded).toEqual(['Внедрение']);
    expect(delta.stagesRemoved).toEqual(['Анализ']);
    expect(delta.stagesChanged).toEqual([{ name: 'Разработка', from: 100, to: 140 }]);
    expect(delta.termDays).toBe(32 - 31); // 09.11–10.12 против 02.11–02.12
  });

  it('разные валюты: денежная разница не считается', () => {
    const usd = version({ id: 'c2', terms: { ...version().terms, currency: 'USD' } });
    const result = cmp([version(), usd]);
    expect(result.sameCurrency).toBe(false);
    expect(result.variants[1].delta).toMatchObject({ totalCost: null, profit: null });
  });

  it('неизвестная стоимость строки спецификации — не 0, сумма помечена неполной', () => {
    const v = version({
      specification: {
        version: 3,
        status: 'confirmed',
        emptySupplyReason: '',
        items: [item({}), item({ id: 'i2', unitPrice: null })],
      },
      latestSpecification: { version: 3, status: 'confirmed' },
    });
    const spec = cmp([v, version({ id: 'c2' })]).variants[0].specification;
    expect(spec.state).toBe('confirmed');
    expect(spec.incomplete).toBe(true);
    expect(spec.totals).toEqual([
      { currency: 'RUB', total: '201', unknownCount: 1, includedCount: 2, incomplete: true },
    ]);
    expect(spec.lines[0]).toContain('неполная сумма');
  });

  it('неподтверждённая спецификация не сравнивается по суммам', () => {
    const v = version({ latestSpecification: { version: 2, status: 'draft' } });
    const [variant, second] = cmp([v, version({ id: 'c2' })]).variants;
    expect(variant.specification).toMatchObject({ state: 'not_confirmed', totals: [] });
    expect(second.specification.state).toBe('none');
    expect(variant.explain.specification).toContain('не входит');
  });

  it('частично сохранённые ставки помечаются по ролям', () => {
    const v = version({ terms: { ...version().terms, roleRates: '{"developer":1000}' } });
    const [variant] = cmp([v, version({ id: 'c2' })]).variants;
    expect(variant.ratesCoverage).toBe('partial');
    expect(variant.rates.find((r) => r.role === 'developer')?.source).toBe('stored');
    expect(variant.rates.find((r) => r.role === 'analyst')?.source).toBe('default');
    expect(variant.explain.cost).toContain('частично');
  });

  it('некорректные сохранённые условия одной версии не ломают сравнение', () => {
    const broken = version({
      id: 'bad',
      terms: { ...version().terms, pricingMode: 'target_margin', marginPercent: 100 },
    });
    const result = compareOffers([version(), broken]);
    const bad = result.variants[1];
    expect(isOfferError(bad)).toBe(true);
    expect(isOfferError(bad) && bad.error).toContain('Целевая маржа');
    expect(isOfferError(result.variants[0])).toBe(false);

    const baseBroken = compareOffers([broken, version({ id: 'c2' })]);
    const second = baseBroken.variants[1];
    expect(!isOfferError(second) && second.delta).toBeNull();
  });
});
