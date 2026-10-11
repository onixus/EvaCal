import { describe, expect, it } from 'vitest';
import { profitForecast, type ProfitForecastInput, type ForecastStageRow } from '@/lib/actuals';

const stage = (over: Partial<ForecastStageRow>): ForecastStageRow => ({
  id: over.id ?? 's',
  name: over.name ?? 'Этап',
  role: 'developer',
  hours: 10,
  status: 'in_progress',
  isApprovalTask: false,
  actualHours: null,
  remainingHoursEstimate: null,
  ...over,
});

function input(over: Partial<ProfitForecastInput> = {}): ProfitForecastInput {
  return {
    stages: [
      stage({ id: 'a', name: 'Анализ', role: 'analyst', status: 'done', actualHours: 12 }),
      stage({ id: 'b', name: 'Разработка', actualHours: 30, remainingHoursEstimate: 20 }),
    ],
    risks: [],
    pmHours: 0,
    actualPmHours: null,
    remainingPmHoursEstimate: null,
    terms: {
      currency: 'RUB',
      pricingMode: 'markup',
      roleRates: '{"developer":1000,"analyst":2000,"pm":1500}',
      overheadPercent: 10,
      marginPercent: 20,
    },
    contractAmount: 100000,
    contractCurrency: 'RUB',
    ...over,
  };
}

describe('profitForecast', () => {
  it('факт × ставки версии + подтверждённый остаток, с накладными', () => {
    const f = profitForecast(input());
    // факт: 12×2000 + 30×1000 = 54000 → ×1.1 = 59400; остаток: 20×1000 → 22000
    expect(f.actualCost).toBe(59400);
    expect(f.remainingCost).toBe(22000);
    expect(f.forecastCost).toBe(81400);
    expect(f.partial).toBe(false);
    expect(f.revenueSource).toBe('contract');
    expect(f.profit).toBe(18600);
    expect(f.marginPercent).toBe(18.6);
    expect(f.lines[0]).toMatchObject({
      remainingHours: 0,
      remainingSource: 'done',
      state: 'known',
    });
  });

  it('этап без факта и без оценки — неизвестно, прогноз неполный, а не 0', () => {
    const f = profitForecast(
      input({
        stages: [
          ...input().stages,
          stage({ id: 'c', name: 'Внедрение', actualHours: null, remainingHoursEstimate: null }),
        ],
      }),
    );
    expect(f.partial).toBe(true);
    expect(f.incomplete).toEqual([{ name: 'Внедрение', state: 'unknown' }]);
    expect(f.forecastCost).toBeNull();
    expect(f.profit).toBeNull();
    expect(f.profitUpperBound).toBe(100000 - 81400);
    const line = f.lines.find((l) => l.stageId === 'c')!;
    expect(line.forecastCost).toBeNull();
    expect(line.actualCost).toBeNull();
    expect(f.explanation.join(' ')).toContain('не считаются нулём');
  });

  it('факт без подтверждённого остатка — неполный; завершённый без факта — неполный', () => {
    const f = profitForecast(
      input({
        stages: [
          stage({ id: 'a', name: 'А', actualHours: 5, remainingHoursEstimate: null }),
          stage({ id: 'b', name: 'Б', status: 'done', actualHours: null }),
        ],
      }),
    );
    expect(f.incomplete).toEqual([
      { name: 'А', state: 'missing_remaining' },
      { name: 'Б', state: 'missing_actual' },
    ]);
  });

  it('подтверждённый остаток без факта — известен (этап ещё не начат)', () => {
    const f = profitForecast(
      input({
        stages: [stage({ id: 'a', actualHours: null, remainingHoursEstimate: 8 })],
      }),
    );
    expect(f.partial).toBe(false);
    expect(f.lines[0]).toMatchObject({ state: 'estimate_only', forecastHours: 8 });
    expect(f.forecastCost).toBe(8800);
  });

  it('у завершённого этапа остаток 0, даже если оценка была записана раньше', () => {
    const f = profitForecast(
      input({
        stages: [stage({ status: 'approved', actualHours: 4, remainingHoursEstimate: 50 })],
      }),
    );
    expect(f.lines[0].remainingHours).toBe(0);
    expect(f.remainingCost).toBe(0);
  });

  it('РП: плановые часы без факта и оценки делают прогноз неполным', () => {
    const f = profitForecast(input({ pmHours: 16 }));
    expect(f.partial).toBe(true);
    expect(f.incomplete).toEqual([{ name: 'Руководство проектом', state: 'unknown' }]);
    const done = profitForecast(
      input({ pmHours: 16, actualPmHours: 6, remainingPmHoursEstimate: 4 }),
    );
    expect(done.partial).toBe(false);
    expect(done.forecastCost).toBe(81400 + 10 * 1500 * 1.1);
  });

  it('без суммы договора выручка — цена КП версии; задачи согласования не учитываются', () => {
    const f = profitForecast(
      input({
        contractAmount: null,
        stages: [
          ...input().stages,
          stage({ id: 'x', isApprovalTask: true, role: 'customer', hours: 0 }),
        ],
      }),
    );
    expect(f.revenueSource).toBe('quote');
    expect(f.lines).toHaveLength(2);
    expect(f.revenue).toBeGreaterThan(0);
    expect(f.partial).toBe(false);
  });

  it('договор в другой валюте: прибыль не считается', () => {
    const f = profitForecast(input({ contractCurrency: 'USD' }));
    expect(f.currencyMismatch).toBe(true);
    expect(f.profit).toBeNull();
    expect(f.revenue).toBeNull();
  });

  it('ставки берутся из версии: те же часы при других ставках версии дают другую себестоимость', () => {
    const a = profitForecast(input());
    const b = profitForecast(
      input({ terms: { ...input().terms, roleRates: '{"developer":2000,"analyst":2000}' } }),
    );
    expect(b.forecastCost).toBeGreaterThan(a.forecastCost!);
    expect(profitForecast(input()).forecastCost).toBe(a.forecastCost);
  });
});
