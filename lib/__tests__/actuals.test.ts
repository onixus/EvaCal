import { describe, it, expect } from 'vitest';
import {
  accuracyBy,
  accuracyPoints,
  accuracyTone,
  actualMargin,
  calculationAccuracy,
  discountBucket,
  discountOutcomes,
  lossReasons,
  matchActuals,
  monthlyWins,
  parseActualsCsv,
  resolveDeal,
  roleBias,
  winRate,
  type DealRow,
} from '../actuals';

const project = {
  dealStatus: 'open',
  actualsClosedAt: null,
  calculations: [
    { id: 'c1', status: 'approved', currency: 'RUB' },
    { id: 'c2', status: 'draft', currency: 'RUB' },
  ],
};

describe('resolveDeal', () => {
  it('won требует утверждённой версии и берёт её валюту', () => {
    const r = resolveDeal(project, { dealStatus: 'won', contractAmount: 1000 });
    expect(r.ok && r.data.wonCalculationId).toBe('c1');
    expect(r.ok && r.data.contractCurrency).toBe('RUB');
    expect(r.ok && r.data.dealClosedAt).toBeInstanceOf(Date);
  });

  it('won без утверждённого расчёта — 409', () => {
    const r = resolveDeal({ ...project, calculations: [] }, { dealStatus: 'won' });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.status).toBe(409);
  });

  it('won с неутверждённой версией — 400', () => {
    const r = resolveDeal(project, { dealStatus: 'won', wonCalculationId: 'c2' });
    expect(!r.ok && r.status).toBe(400);
  });

  it('lost требует причины', () => {
    expect(resolveDeal(project, { dealStatus: 'lost' }).ok).toBe(false);
    const r = resolveDeal(project, { dealStatus: 'lost', lossReason: 'price', competitor: ' X ' });
    expect(r.ok && r.data.lossReason).toBe('price');
    expect(r.ok && r.data.competitor).toBe('X');
  });

  it('open сбрасывает дату закрытия', () => {
    const r = resolveDeal(project, { dealStatus: 'open' });
    expect(r.ok && r.data.dealClosedAt).toBeNull();
  });

  it('при закрытом факте исход не меняется, включая повторное «выиграно»', () => {
    const closed = { ...project, actualsClosedAt: new Date() };
    expect(!resolveDeal(closed, { dealStatus: 'lost', lossReason: 'price' })).toBe(false);
    const again = resolveDeal(closed, { dealStatus: 'won', wonCalculationId: 'c1' });
    expect(!again.ok && again.status).toBe(409);
  });

  it('смена выигранной версии при внесённом факте — 409, без факта — можно', () => {
    const twoApproved = {
      ...project,
      dealStatus: 'won',
      wonCalculationId: 'c1',
      calculations: [
        { id: 'c1', status: 'approved', currency: 'RUB' },
        { id: 'c9', status: 'approved', currency: 'USD' },
      ],
    };
    const blocked = resolveDeal(
      { ...twoApproved, hasActuals: true },
      { dealStatus: 'won', wonCalculationId: 'c9' },
    );
    expect(!blocked.ok && blocked.status).toBe(409);
    const ok = resolveDeal(
      { ...twoApproved, hasActuals: false },
      { dealStatus: 'won', wonCalculationId: 'c9' },
    );
    expect(ok.ok && ok.data.wonCalculationId).toBe('c9');
  });

  it('повторное «выиграно» без суммы сохраняет прежнюю сумму и валюту', () => {
    const r = resolveDeal(
      {
        ...project,
        dealStatus: 'won',
        wonCalculationId: 'c1',
        contractAmount: 500,
        contractCurrency: 'EUR',
      },
      { dealStatus: 'won', wonCalculationId: 'c1' },
    );
    expect(r.ok && r.data.contractAmount).toBe(500);
    expect(r.ok && r.data.contractCurrency).toBe('EUR');
    const cleared = resolveDeal(
      { ...project, dealStatus: 'won', wonCalculationId: 'c1', contractAmount: 500 },
      { dealStatus: 'won', wonCalculationId: 'c1', contractAmount: null },
    );
    expect(cleared.ok && cleared.data.contractAmount).toBeNull();
  });

  it('отрицательная сумма — 400', () => {
    expect(resolveDeal(project, { dealStatus: 'won', contractAmount: -1 }).ok).toBe(false);
  });
});

describe('calculationAccuracy', () => {
  const stages = [
    { name: 'A', role: 'engineer', hours: 10, isApprovalTask: false, actualHours: 12 },
    { name: 'B', role: 'analyst', hours: 20, isApprovalTask: false, actualHours: null },
    { name: 'Согл.', role: 'customer', hours: 0, isApprovalTask: true, actualHours: null },
  ];

  it('этапы без факта не входят в знаменатель', () => {
    const acc = calculationAccuracy(stages);
    expect(acc.covered).toBe(1);
    expect(acc.total).toBe(2);
    expect(acc.plannedCovered).toBe(10);
    expect(acc.actualCovered).toBe(12);
    expect(acc.ratio).toBe(1.2);
    expect(acc.deviation).toBe(0.2);
    expect(acc.complete).toBe(false);
  });

  it('без факта вовсе — null', () => {
    const acc = calculationAccuracy([stages[1]]);
    expect(acc.ratio).toBeNull();
  });

  it('зоны точности', () => {
    expect(accuracyTone(null)).toBe('none');
    expect(accuracyTone(0.05)).toBe('ok');
    expect(accuracyTone(-0.2)).toBe('warn');
    expect(accuracyTone(0.5)).toBe('bad');
  });
});

describe('actualMargin', () => {
  it('считает себестоимость по ставкам с оверхедом и помечает частичный факт', () => {
    const m = actualMargin({
      stages: [
        { name: 'A', role: 'engineer', hours: 10, isApprovalTask: false, actualHours: 10 },
        { name: 'B', role: 'analyst', hours: 5, isApprovalTask: false, actualHours: null },
      ],
      actualPmHours: 2,
      roleRates: JSON.stringify({ engineer: 1000, pm: 500 }),
      overheadPercent: 10,
      contractAmount: 22000,
    });
    // 10×1000 + 2×500 = 11000, ×1.1 = 12100
    expect(m.actualCost).toBe(12100);
    expect(m.actualHours).toBe(12);
    expect(m.margin).toBe(0.45);
    expect(m.partial).toBe(true);
  });

  it('без суммы договора маржа null', () => {
    const m = actualMargin({
      stages: [],
      actualPmHours: null,
      roleRates: null,
      overheadPercent: 0,
      contractAmount: null,
    });
    expect(m.margin).toBeNull();
    expect(m.actualCost).toBe(0);
  });
});

describe('аналитика сделок', () => {
  const deal = (p: Partial<DealRow>): DealRow => ({
    id: 'x',
    dealStatus: 'open',
    dealClosedAt: null,
    lossReason: null,
    createdBy: 'presale',
    discountPercent: 0,
    templateName: 'T',
    ...p,
  });
  const rows = [
    deal({ dealStatus: 'won', discountPercent: 0, dealClosedAt: new Date('2026-01-10') }),
    deal({ dealStatus: 'won', discountPercent: 5, dealClosedAt: new Date('2026-01-20') }),
    deal({
      dealStatus: 'lost',
      discountPercent: 25,
      lossReason: 'price',
      dealClosedAt: new Date('2026-02-01'),
    }),
    deal({
      dealStatus: 'lost',
      discountPercent: 8,
      lossReason: 'price',
      dealClosedAt: new Date('2026-02-05'),
    }),
    deal({ dealStatus: 'cancelled' }),
    deal({ dealStatus: 'open' }),
  ];

  it('win rate не считает отменённые проигрышем', () => {
    const w = winRate(rows);
    expect(w).toMatchObject({ won: 2, lost: 2, cancelled: 1, open: 1, rate: 0.5, lowSample: true });
  });

  it('бакеты скидки', () => {
    expect(discountBucket(0)).toBe('0');
    expect(discountBucket(5)).toBe('1-5');
    expect(discountBucket(5.5)).toBe('6-10');
    expect(discountBucket(20)).toBe('11-20');
    expect(discountBucket(21)).toBe('20+');
    expect(discountBucket(null)).toBeNull();
    const out = discountOutcomes(rows);
    expect(out.find((o) => o.key === '20+')?.winRate.lost).toBe(1);
    expect(out.every((o) => o.winRate.lowSample)).toBe(true);
  });

  it('причины проигрышей и помесячно', () => {
    expect(lossReasons(rows)).toEqual([{ reason: 'price', label: 'Цена', count: 2, share: 1 }]);
    expect(monthlyWins(rows)).toEqual([
      { month: '2026-01', won: 2, lost: 0, rate: 1 },
      { month: '2026-02', won: 0, lost: 2, rate: 0 },
    ]);
  });
});

describe('аналитика точности', () => {
  const calc = (id: string, arch: string, devs: [string, number, number][]) => ({
    id,
    name: id,
    templateName: 'T',
    architect: arch,
    closedAt: null,
    stages: devs.map(([role, plan, act]) => ({
      name: role,
      role,
      hours: plan,
      isApprovalTask: false,
      actualHours: act,
    })),
  });
  const rows = [
    calc('a', 'ann', [
      ['engineer', 10, 15],
      ['analyst', 10, 9],
    ]),
    calc('b', 'bob', [['engineer', 10, 12]]),
    calc('c', 'bob', [['engineer', 10, 10]]),
  ];

  it('точки, смещение по ролям и группировка', () => {
    const pts = accuracyPoints(rows);
    expect(pts.map((p) => p.ratio)).toEqual([1.2, 1.2, 1]);
    const bias = roleBias(rows);
    expect(bias[0]).toMatchObject({ role: 'engineer', samples: 3, medianDeviation: 0.2 });
    const byArch = accuracyBy(pts, (p) => p.architect);
    expect(byArch[0].group).toBe('bob');
    expect(byArch[0].medianAbsDeviation).toBe(0.1);
  });
});

describe('CSV-импорт факта', () => {
  it('разбирает заголовок, разделители и сопоставляет по имени', () => {
    const { rows, invalid } = parseActualsCsv(
      'Этап;Часы\nОбследование; 12,5\n"Проектирование",8\nМусор;abc\nОтриц;-1\n',
    );
    expect(rows).toEqual([
      { stage: 'Обследование', hours: 12.5, start: undefined, end: undefined },
      { stage: 'Проектирование', hours: 8, start: undefined, end: undefined },
    ]);
    expect(invalid).toEqual(['Мусор;abc', 'Отриц;-1']);
    const res = matchActuals(
      rows,
      [
        { id: 's1', name: 'обследование ', isApprovalTask: false },
        { id: 's2', name: 'Согласование', isApprovalTask: true },
      ],
      invalid,
    );
    expect(res.matched).toEqual([
      { stageId: 's1', name: 'обследование ', hours: 12.5, start: undefined, end: undefined },
    ]);
    expect(res.unmatched).toEqual(['Проектирование']);
    expect(res.invalid).toHaveLength(2);
    expect(res.ambiguous).toEqual([]);
  });

  it('одноимённые этапы не сливаются: строка помечается неоднозначной', () => {
    const res = matchActuals(
      [{ stage: 'Проектирование', hours: 10 }],
      [
        { id: 'a', name: 'Проектирование', isApprovalTask: false },
        { id: 'b', name: 'проектирование', isApprovalTask: false },
      ],
    );
    expect(res.matched).toEqual([]);
    expect(res.ambiguous).toEqual(['Проектирование']);
  });
});
