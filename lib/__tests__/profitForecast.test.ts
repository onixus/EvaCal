import { describe, expect, it } from 'vitest';
import {
  parseHoursInput,
  profitForecast,
  tryProfitForecast,
  type ForecastStageRow,
  type ProfitForecast,
  type ProfitForecastInput,
} from '@/lib/actuals';

/** Пары «строка — состояние» без текста причины. */
const states = (f: ProfitForecast) => f.incomplete.map(({ name, state }) => ({ name, state }));

const stage = (over: Partial<ForecastStageRow>): ForecastStageRow => ({
  id: over.id ?? 's',
  name: over.name ?? 'Этап',
  role: 'developer',
  hours: 10,
  status: 'in_progress',
  isApprovalTask: false,
  actualHours: null,
  remainingHoursEstimate: null,
  // По умолчанию оценка подтверждена при текущем факте (не устарела).
  remainingActualBaseline: over.actualHours ?? null,
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
    remainingPmActualBaseline: over.actualPmHours ?? null,
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
    expect(states(f)).toEqual([{ name: 'Внедрение', state: 'unknown' }]);
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
    expect(states(f)).toEqual([
      { name: 'А', state: 'missing_remaining' },
      { name: 'Б', state: 'missing_actual' },
    ]);
  });

  it('подтверждённый остаток без факта — известен (этап ещё не начат)', () => {
    const f = profitForecast(
      input({
        stages: [
          stage({ id: 'a', status: 'planned', actualHours: null, remainingHoursEstimate: 8 }),
        ],
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
    expect(states(f)).toEqual([{ name: 'Руководство проектом', state: 'unknown' }]);
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

  it('начатый этап с оценкой, но без факта — факт не внесён, прогноз неполный', () => {
    const f = profitForecast(
      input({
        stages: [
          stage({ id: 'a', name: 'А', status: 'in_progress', remainingHoursEstimate: 8 }),
          stage({ id: 'b', name: 'Б', status: 'rejected', remainingHoursEstimate: 4 }),
        ],
      }),
    );
    expect(f.partial).toBe(true);
    expect(states(f)).toEqual([
      { name: 'А', state: 'missing_actual' },
      { name: 'Б', state: 'missing_actual' },
    ]);
    expect(f.incomplete[0].reason).toContain('работа начата');
    expect(f.forecastCost).toBeNull();
  });

  it('РП: оценка без факта допустима только до начала работ по проекту', () => {
    const notStarted = profitForecast(
      input({
        stages: [stage({ status: 'planned', remainingHoursEstimate: 10 })],
        pmHours: 8,
        remainingPmHoursEstimate: 8,
      }),
    );
    expect(notStarted.partial).toBe(false);
    const started = profitForecast(input({ pmHours: 8, remainingPmHoursEstimate: 8 }));
    expect(states(started)).toEqual([{ name: 'Руководство проектом', state: 'missing_actual' }]);
  });

  it('факт изменился после оценки — оценка устарела, прогноз неполный с причиной', () => {
    const f = profitForecast(
      input({
        stages: [
          stage({
            id: 'b',
            name: 'Разработка',
            actualHours: 30,
            remainingHoursEstimate: 20,
            remainingActualBaseline: 10,
          }),
        ],
      }),
    );
    expect(f.partial).toBe(true);
    expect(states(f)).toEqual([{ name: 'Разработка', state: 'stale_estimate' }]);
    expect(f.incomplete[0].reason).toContain('при факте 10 ч, сейчас 30 ч');
    const line = f.lines[0];
    expect(line).toMatchObject({ remainingHours: 20, remainingCost: null, forecastCost: null });
    expect(line.remainingActualBaseline).toBe(10);
    // Устаревший остаток не входит даже в нижнюю границу затрат.
    expect(f.remainingCost).toBe(0);
    expect(f.knownCost).toBe(33000);
  });

  it('оценка до появления факта устаревает, когда факт внесён', () => {
    const f = profitForecast(
      input({
        stages: [
          stage({
            status: 'in_progress',
            actualHours: 5,
            remainingHoursEstimate: 8,
            remainingActualBaseline: null,
          }),
        ],
      }),
    );
    expect(f.incomplete.map((i) => i.state)).toEqual(['stale_estimate']);
  });

  it('устаревшая оценка РП тоже делает прогноз неполным', () => {
    const f = profitForecast(
      input({ actualPmHours: 9, remainingPmHoursEstimate: 4, remainingPmActualBaseline: 6 }),
    );
    expect(states(f)).toEqual([{ name: 'Руководство проектом', state: 'stale_estimate' }]);
  });

  it('некорректные условия версии — ошибка прогноза, а не исключение', () => {
    const r = tryProfitForecast(
      input({ terms: { ...input().terms, pricingMode: 'unknown_mode' } }),
    );
    expect('error' in r && r.error).toContain('Прогноз не рассчитан');
    expect('error' in tryProfitForecast(input())).toBe(false);
  });
});

describe('parseHoursInput', () => {
  it('принимает числа и строки из цифр, null и пустую строку — очистить', () => {
    expect(parseHoursInput(5)).toBe(5);
    expect(parseHoursInput('12.5')).toBe(12.5);
    expect(parseHoursInput(0)).toBe(0);
    expect(parseHoursInput(null)).toBeNull();
    expect(parseHoursInput('')).toBeNull();
  });

  it('отвергает пробелы, нечисловые строки, массивы, логические и отрицательные', () => {
    for (const v of [' ', '  3 ', 'abc', '1e3', '-1', -1, [], [5], true, {}, Infinity, NaN]) {
      expect(parseHoursInput(v)).toBeUndefined();
    }
  });
});
