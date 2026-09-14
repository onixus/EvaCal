import { describe, it, expect } from 'vitest';
import {
  buildCapacityMatrix,
  capacityFor,
  selectVersionPerProject,
  signalFor,
  spreadStageByWeek,
  warningsForCalculation,
  weekKey,
  weightFor,
  type CapacityCalcRow,
} from '../capacity';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

const calc = (over: Partial<CapacityCalcRow>): CapacityCalcRow => ({
  id: 'c1',
  name: 'Calc',
  version: 1,
  status: 'approved',
  projectId: 'p1',
  projectName: 'P',
  dealStatus: 'open',
  wonCalculationId: null,
  projectStatus: 'active',
  includeWeekends: false,
  stages: [],
  ...over,
});

describe('недели и раскладка этапа', () => {
  it('понедельник ISO-недели', () => {
    expect(weekKey(d('2026-03-04'))).toBe('2026-03-02'); // среда → понедельник
    expect(weekKey(d('2026-03-08'))).toBe('2026-03-02'); // воскресенье → тот же понедельник
    expect(weekKey(d('2026-03-09'))).toBe('2026-03-09');
  });

  it('раскладывает по рабочим дням через границу недели и выходные', () => {
    // Чт 5.03 – Вт 10.03: рабочие дни 5,6,9,10 → по 10 ч; неделя 2.03 = 20, 9.03 = 20
    const m = spreadStageByWeek(
      { hours: 40, startDate: d('2026-03-05'), endDate: d('2026-03-10') },
      false,
    );
    expect([...m.entries()]).toEqual([
      ['2026-03-02', 20],
      ['2026-03-09', 20],
    ]);
  });

  it('с выходными считает все дни', () => {
    const m = spreadStageByWeek(
      { hours: 60, startDate: d('2026-03-05'), endDate: d('2026-03-10') },
      true,
    );
    expect(m.get('2026-03-02')).toBe(40); // 5,6,7,8 → 4 дня × 10
    expect(m.get('2026-03-09')).toBe(20);
  });

  it('этап целиком в выходных без includeWeekends падает на неделю начала', () => {
    const m = spreadStageByWeek(
      { hours: 8, startDate: d('2026-03-07'), endDate: d('2026-03-08') },
      false,
    );
    expect(m.get('2026-03-02')).toBe(8);
  });
});

describe('веса и выбор версии', () => {
  it('веса по статусу и сделке', () => {
    expect(weightFor(calc({ dealStatus: 'won', wonCalculationId: 'c1' })).weight).toBe(1);
    expect(weightFor(calc({ dealStatus: 'won', wonCalculationId: 'other' })).weight).toBe(0);
    expect(weightFor(calc({ status: 'approved' })).weight).toBe(0.6);
    expect(weightFor(calc({ status: 'pending_approval' })).weight).toBe(0.3);
    expect(weightFor(calc({ status: 'draft' })).weight).toBe(0);
    expect(weightFor(calc({ status: 'draft' }), true).weight).toBe(0.1);
    expect(weightFor(calc({ dealStatus: 'lost' })).weight).toBe(0);
    expect(weightFor(calc({ projectStatus: 'archived' })).weight).toBe(0);
  });

  it('одна версия на проект: выигранная > утверждённая > на согласовании; черновики не суммируются', () => {
    const rows = [
      calc({ id: 'a', version: 1, status: 'approved' }),
      calc({ id: 'b', version: 2, status: 'pending_approval' }),
      calc({ id: 'c', version: 3, status: 'draft' }),
      calc({ id: 'x', projectId: 'p2', version: 1, status: 'draft' }),
    ];
    expect(selectVersionPerProject(rows).map((c) => c.id)).toEqual(['a']);
    expect(selectVersionPerProject(rows, true).map((c) => c.id)).toEqual(['a', 'x']);
    const won = [...rows, calc({ id: 'w', version: 0, status: 'approved' })].map((c) => ({
      ...c,
      dealStatus: 'won',
      wonCalculationId: 'w',
    }));
    expect(selectVersionPerProject(won).map((c) => c.id)).toEqual(['w']);
  });
});

describe('ёмкость и сигналы', () => {
  const caps = [
    { role: 'engineer', headcount: 2, hoursPerWeek: 30, effectiveFrom: d('2026-01-01') },
    { role: 'engineer', headcount: 3, hoursPerWeek: 30, effectiveFrom: d('2026-03-09') },
  ];
  it('берёт последнюю строку до недели; до первой строки — неизвестна', () => {
    expect(capacityFor('engineer', d('2026-03-02'), caps)).toBe(60);
    expect(capacityFor('engineer', d('2026-03-09'), caps)).toBe(90);
    expect(capacityFor('engineer', d('2025-12-29'), caps)).toBeNull();
    expect(capacityFor('analyst', d('2026-03-09'), caps)).toBeNull();
  });
  it('пороги', () => {
    expect(signalFor(null)).toBe('unknown');
    expect(signalFor(1.2)).toBe('over');
    expect(signalFor(0.9)).toBe('high');
    expect(signalFor(0.5)).toBe('ok');
    expect(signalFor(0.2)).toBe('idle');
  });
});

describe('матрица и what-if', () => {
  const calcs = [
    calc({
      id: 'won',
      name: 'Won',
      projectId: 'p1',
      dealStatus: 'won',
      wonCalculationId: 'won',
      stages: [
        {
          role: 'engineer',
          hours: 50,
          isApprovalTask: false,
          startDate: d('2026-03-02'),
          endDate: d('2026-03-06'),
        },
        {
          role: 'customer',
          hours: 10,
          isApprovalTask: false,
          startDate: d('2026-03-02'),
          endDate: d('2026-03-06'),
        },
        {
          role: 'engineer',
          hours: 5,
          isApprovalTask: true,
          startDate: d('2026-03-02'),
          endDate: d('2026-03-06'),
        },
      ],
    }),
    calc({
      id: 'pend',
      name: 'Pending',
      projectId: 'p2',
      status: 'pending_approval',
      stages: [
        {
          role: 'Инженер ИБ',
          hours: 100,
          isApprovalTask: false,
          startDate: d('2026-03-02'),
          endDate: d('2026-03-06'),
        },
      ],
    }),
  ];
  const caps = [
    { role: 'engineer', headcount: 2, hoursPerWeek: 30, effectiveFrom: d('2026-01-01') },
  ];

  it('твёрдый и взвешенный спрос, заказчик и согласования не считаются', () => {
    const m = buildCapacityMatrix({ calcs, capacities: caps, from: d('2026-03-04'), weeks: 2 });
    expect(m.weeks).toEqual(['2026-03-02', '2026-03-09']);
    const eng = m.roles.find((r) => r.role === 'engineer')!;
    expect(m.roles.map((r) => r.role)).toEqual(['engineer']);
    const cell = eng.cells[0];
    expect(cell.firmHours).toBe(50);
    expect(cell.weightedHours).toBe(80); // 50 + 100×0.3
    expect(cell.capacityHours).toBe(60);
    expect(cell.weightedUtil).toBe(1.33);
    expect(cell.signal).toBe('over');
    expect(cell.items.map((i) => i.calculationId)).toEqual(['pend', 'won']);
    expect(eng.cells[1].signal).toBe('idle');
  });

  it('предупреждения для расчёта только там, где он вносит часы', () => {
    const m = buildCapacityMatrix({ calcs, capacities: caps, from: d('2026-03-02'), weeks: 2 });
    const w = warningsForCalculation(m, 'won');
    expect(w).toEqual([{ role: 'engineer', weeks: ['2026-03-02'], maxUtil: 1.33, ownHours: 50 }]);
    expect(warningsForCalculation(m, 'nope')).toEqual([]);
  });

  it('what-if сдвигает расчёт, не меняя входные данные', () => {
    const before = JSON.stringify(calcs);
    const m = buildCapacityMatrix({
      calcs,
      capacities: caps,
      from: d('2026-03-02'),
      weeks: 2,
      shifts: [{ calculationId: 'pend', shiftDays: 7 }],
    });
    const eng = m.roles[0];
    expect(eng.cells[0].weightedHours).toBe(50);
    expect(eng.cells[1].weightedHours).toBe(30);
    expect(JSON.stringify(calcs)).toBe(before);
  });

  it('фильтр ролей и горизонт', () => {
    const m = buildCapacityMatrix({
      calcs,
      capacities: caps,
      from: d('2026-03-02'),
      weeks: 1,
      roles: ['analyst'],
    });
    expect(m.roles).toEqual([]);
  });
});
