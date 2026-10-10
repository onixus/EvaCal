import { describe, expect, it } from 'vitest';
import {
  buildCapacityMatrix,
  type CapacityCalcRow,
  type CapacityOptions,
  type RoleCapacityRow,
} from '../capacity';
import {
  compareVariants,
  demandFromMatrix,
  findEarliestStart,
  headHoursFor,
  parseVariants,
  reschedulePlan,
  type CalcPlan,
} from '../planning';
import {
  expandWithApprovals,
  validateDependencies,
  type ScheduleConfig,
  type StagePlanItem,
} from '../scheduling';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const cfg: ScheduleConfig = { workDayHours: 6, includeWeekends: false };
const capacity = (hoursPerWeek: number, from = '2026-01-05', headcount = 1): RoleCapacityRow => ({
  role: 'architect',
  headcount,
  hoursPerWeek,
  effectiveFrom: d(from),
});

function makePlan(hours: number, id = 'c1'): CalcPlan {
  const items = expandWithApprovals([{ name: 'Работа', role: 'architect', hours }]);
  return {
    calculationId: id,
    name: id,
    startDate: d('2026-03-02'),
    items,
    stageIds: items.map((_, i) => `${id}-s${i}`),
    dependencies: [],
    config: cfg,
    roleRates: null,
  };
}

function calcRow(plan: CalcPlan, over: Partial<CapacityCalcRow> = {}): CapacityCalcRow {
  return {
    id: plan.calculationId,
    name: plan.name,
    version: 1,
    status: 'approved',
    projectId: plan.calculationId,
    projectName: null,
    dealStatus: 'won',
    wonCalculationId: plan.calculationId,
    projectStatus: 'active',
    includeWeekends: false,
    stages: reschedulePlan(plan, plan.startDate).map((s) => ({
      role: s.role,
      hours: s.hours,
      isApprovalTask: s.isApprovalTask,
      startDate: s.startDate,
      endDate: s.endDate,
    })),
    ...over,
  };
}

describe('зависимости: обратные рёбра отклоняются и у параллельных этапов', () => {
  it('C ∥ → B ∥ (обе параллельны A): не цикл с неявной цепочкой, но отклоняется', () => {
    const stage = (name: string, parallel: boolean): StagePlanItem => ({
      name,
      role: 'architect',
      hours: 6,
      isApprovalTask: false,
      requirements: null,
      parallel,
      approvalDays: null,
    });
    const items = [stage('A', false), stage('B', true), stage('C', true)];
    const issue = validateDependencies(items, [{ from: 2, to: 1, lagDays: 0 }]);
    expect(issue?.code).toBe('cycle');
    expect(issue?.message).toMatch(/выше по списку/);
    expect(validateDependencies(items, [{ from: 1, to: 2, lagDays: 0 }])).toBeNull();
  });
});

describe('варианты: доработки по ревью', () => {
  const p = makePlan(30);
  const base: CapacityOptions = {
    calcs: [calcRow(p)],
    capacities: [capacity(30)],
    from: d('2026-03-02'),
    weeks: 8,
  };

  it('несколько сдвигов одного расчёта в варианте складываются', () => {
    const variants = parseVariants([
      {
        changes: [
          { type: 'shift', calculationId: 'c1', shiftDays: 7 },
          { type: 'shift', calculationId: 'c1', shiftDays: 7 },
        ],
      },
      { changes: [{ type: 'shift', calculationId: 'c1', shiftDays: 14 }] },
    ]);
    const out = compareVariants({ base, plans: new Map([['c1', p]]), variants });
    expect(out.variants[0].ends[0].endDate).toBe(out.variants[1].ends[0].endDate);
    expect(out.variants[0].ends[0].deltaDays).toBe(14);
  });

  it('часы на человека берутся из ёмкости, действующей с начала изменения команды', () => {
    const rows = [capacity(20, '2026-01-05'), capacity(35, '2026-06-01')];
    expect(headHoursFor('architect', rows, d('2026-03-02'))).toBe(20);
    expect(headHoursFor('architect', rows, d('2026-07-06'))).toBe(35);
    expect(headHoursFor('architect', rows, d('2025-12-01'))).toBe(20); // раньше всех — ближайшая
    expect(headHoursFor('analyst', rows, d('2026-03-02'))).toBe(30);
    const variants = parseVariants([
      {
        changes: [
          {
            type: 'team',
            role: 'architect',
            headcountDelta: 1,
            from: '2026-03-02',
            to: '2026-03-08',
            costPerHour: 1,
          },
        ],
      },
    ]);
    const out = compareVariants({
      base: { ...base, capacities: rows },
      plans: new Map([['c1', p]]),
      variants,
    });
    expect(out.variants[0].costDelta).toBe(20);
  });

  it('сокращение команды экономит только реально снятые часы (ёмкость не ниже нуля)', () => {
    const variants = parseVariants([
      {
        changes: [
          {
            type: 'team',
            role: 'architect',
            headcountDelta: -2, // −60 ч/нед при ёмкости 30
            from: '2026-03-02',
            to: '2026-03-15',
            costPerHour: 100,
          },
        ],
      },
    ]);
    const out = compareVariants({ base, plans: new Map([['c1', p]]), variants });
    // Две недели по 30 ч, а не по 60.
    expect(out.variants[0].costDelta).toBe(-60 * 100);
    expect(out.variants[0].matrix.roles[0].cells[0].capacityHours).toBe(0);
  });
});

describe('ближайшая дата: одинаковая мера спроса и горизонт', () => {
  it('спрос других — невзвешенные часы, как и у самого расчёта', () => {
    // Другой проект на согласовании: вес 0,3, но 24 ч — это 24 ч, если он состоится.
    const other = makePlan(24, 'o1');
    const matrix = buildCapacityMatrix({
      calcs: [
        calcRow(other, { status: 'pending_approval', dealStatus: 'open', wonCalculationId: null }),
      ],
      capacities: [capacity(30)],
      from: d('2026-03-02'),
      weeks: 4,
      includeDrafts: true,
    });
    const demand = demandFromMatrix(matrix);
    expect(demand.get('architect')?.get('2026-03-02')).toBe(24);
    expect(matrix.roles[0].cells[0].weightedHours).toBeCloseTo(7.2);
    const r = findEarliestStart({
      plan: makePlan(12),
      from: d('2026-03-02'),
      capacities: [capacity(30)],
      otherDemand: demand,
      knownWeeks: new Set(matrix.weeks),
    });
    // 24 + 12 > 30 → старт в пн 2.03 не подходит (по взвешенному 7,2 + 12 подошёл бы).
    expect(r.conflictAtFrom).toMatchObject({ kind: 'over', week: '2026-03-02', demand: 36 });
    // Пт 6.03: 6 ч в этой неделе (24 + 6 = 30) и 6 ч в следующей.
    expect(r.startDate?.toISOString()).toBe('2026-03-06T09:00:00.000Z');
  });

  it('неделя за горизонтом спроса — неизвестно, а не свободно', () => {
    const r = findEarliestStart({
      plan: makePlan(12),
      from: d('2026-03-02'),
      capacities: [capacity(30)],
      otherDemand: new Map([['architect', new Map([['2026-03-02', 30]])]]),
      knownWeeks: new Set(['2026-03-02']),
    });
    // 2.03 занята полностью, следующая неделя за горизонтом — дату не подтвердить.
    expect(r.startDate).toBeNull();
    expect(r.beyondHorizon).toBe(true);
    expect(r.conflictAtFrom?.kind).toBe('over');

    const free = findEarliestStart({
      plan: makePlan(12),
      from: d('2026-03-02'),
      capacities: [capacity(30)],
      otherDemand: new Map(),
      knownWeeks: new Set(['2026-03-02']),
    });
    expect(free.startDate?.toISOString()).toBe('2026-03-02T09:00:00.000Z');
    expect(free.beyondHorizon).toBe(false);
  });
});
