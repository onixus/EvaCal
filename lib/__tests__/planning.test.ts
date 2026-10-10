import { describe, expect, it } from 'vitest';
import { buildWorkCalendar, type WorkCalendar } from '../calendar';
import type { CapacityCalcRow, CapacityOptions, RoleCapacityRow } from '../capacity';
import { capacityFor } from '../capacity';
import {
  compareVariants,
  findEarliestStart,
  parseVariants,
  reschedulePlan,
  type CalcPlan,
} from '../planning';
import { expandWithApprovals, type ScheduleConfig } from '../scheduling';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (x: Date | null) => (x ? x.toISOString() : null);
// 2026-03-02 — понедельник.
const cfg = (calendar?: WorkCalendar): ScheduleConfig => ({
  workDayHours: 6,
  includeWeekends: false,
  calendar,
});

function plan(over: Partial<CalcPlan> = {}, hours = 6, role = 'architect'): CalcPlan {
  const items = expandWithApprovals([{ name: 'Работа', role, hours }]);
  return {
    calculationId: 'c1',
    name: 'Проект',
    startDate: d('2026-03-02'),
    items,
    stageIds: items.map((_, i) => `st${i}`),
    dependencies: [],
    config: cfg(),
    roleRates: null,
    ...over,
  };
}

const capacity = (role: string, headcount = 1, hoursPerWeek = 30): RoleCapacityRow => ({
  role,
  headcount,
  hoursPerWeek,
  effectiveFrom: d('2026-01-05'),
});

const demand = (role: string, weeks: Record<string, number>) =>
  new Map([[role, new Map(Object.entries(weeks))]]);

describe('ближайшая доступная дата старта', () => {
  it('без конфликта — сама дата from', () => {
    const r = findEarliestStart({
      plan: plan(),
      from: d('2026-03-02'),
      capacities: [capacity('architect')],
      otherDemand: new Map(),
    });
    expect(iso(r.startDate)).toBe('2026-03-02T09:00:00.000Z');
    expect(r.shiftDays).toBe(0);
    expect(r.conflictAtFrom).toBeNull();
  });

  it('резерв роли занимает неделю — старт переносится на следующую', () => {
    const r = findEarliestStart({
      plan: plan(),
      from: d('2026-03-02'),
      capacities: [capacity('architect')],
      reservations: [
        { role: 'architect', from: d('2026-03-02'), to: d('2026-03-08'), hoursPerWeek: 26 },
      ],
      otherDemand: new Map(),
    });
    expect(r.conflictAtFrom).toMatchObject({ role: 'architect', week: '2026-03-02', capacity: 4 });
    expect(iso(r.startDate)).toBe('2026-03-09T09:00:00.000Z');
    expect(r.shiftDays).toBe(7);
  });

  it('праздник: не стартует в нерабочий день и снижает ёмкость недели', () => {
    const holiday = buildWorkCalendar({ exceptions: [{ date: '2026-03-02', kind: 'holiday' }] });
    const other = demand('architect', { '2026-03-02': 24 });
    // Без праздника 24 + 6 = 30 ≤ 30 — старт в пн.
    const plain = findEarliestStart({
      plan: plan(),
      from: d('2026-03-02'),
      capacities: [capacity('architect')],
      otherDemand: other,
    });
    expect(iso(plain.startDate)).toBe('2026-03-02T09:00:00.000Z');
    // С праздником в пн: ёмкость недели 24, этап не влезает → следующий пн.
    const r = findEarliestStart({
      plan: plan({ config: cfg(holiday) }),
      from: d('2026-03-02'),
      capacities: [capacity('architect')],
      capacityCalendar: holiday,
      otherDemand: other,
    });
    expect(iso(r.startDate)).toBe('2026-03-09T09:00:00.000Z');
    // Праздник в пн не проверяется как дата старта.
    expect(r.checkedDays).toBe(5);
  });

  it('роль без заданной ёмкости не ограничивает; невлезающий этап — null', () => {
    const free = findEarliestStart({
      plan: plan({}, 6, 'developer'),
      from: d('2026-03-02'),
      capacities: [capacity('architect')],
      otherDemand: new Map(),
    });
    expect(free.startDate).not.toBeNull();
    const never = findEarliestStart({
      plan: plan({}, 200),
      from: d('2026-03-02'),
      horizonDays: 14,
      capacities: [capacity('architect', 1, 10)],
      otherDemand: new Map(),
    });
    expect(never.startDate).toBeNull();
    expect(never.checkedDays).toBe(10);
  });

  it('учитывает зависимости этапов при построении Ганта кандидата', () => {
    const items = expandWithApprovals([
      { name: 'A', role: 'architect', hours: 6 },
      { name: 'B', role: 'architect', hours: 6 },
      { name: 'C', role: 'architect', hours: 6 },
    ]);
    const p = plan({
      items,
      stageIds: ['a', 'b', 'c'],
      dependencies: [{ from: 0, to: 2, lagDays: 5 }],
    });
    const stages = reschedulePlan(p, d('2026-03-02'));
    expect(iso(stages[2].startDate)).toBe('2026-03-10T09:00:00.000Z');
  });
});

describe('варианты: сдвиг / подрядчик / команда', () => {
  const holidayCal = buildWorkCalendar({ exceptions: [{ date: '2026-03-11', kind: 'holiday' }] });
  const items = expandWithApprovals([{ name: 'Монтаж', role: 'architect', hours: 60 }]);
  const p: CalcPlan = {
    calculationId: 'c1',
    name: 'Проект',
    startDate: d('2026-03-02'),
    items,
    stageIds: ['s1'],
    dependencies: [],
    config: cfg(holidayCal),
    roleRates: JSON.stringify({ architect: 5000 }),
  };
  const baseStages = reschedulePlan(p, p.startDate);
  const calc: CapacityCalcRow = {
    id: 'c1',
    name: 'Проект',
    version: 1,
    status: 'approved',
    projectId: 'p1',
    projectName: 'P',
    dealStatus: 'won',
    wonCalculationId: 'c1',
    projectStatus: 'active',
    includeWeekends: false,
    calendar: holidayCal,
    stages: baseStages.map((s) => ({
      role: s.role,
      hours: s.hours,
      isApprovalTask: s.isApprovalTask,
      startDate: s.startDate,
      endDate: s.endDate,
    })),
  };
  const base: CapacityOptions = {
    calcs: [calc],
    capacities: [capacity('architect', 1, 20)],
    from: d('2026-03-02'),
    weeks: 6,
    calendar: holidayCal,
  };
  const variants = parseVariants([
    {
      id: 'shift',
      label: 'На 2 недели позже',
      changes: [{ type: 'shift', calculationId: 'c1', shiftDays: 14 }],
    },
    {
      id: 'contractor',
      label: 'Подрядчик',
      changes: [
        {
          type: 'contractor',
          calculationId: 'c1',
          role: 'architect',
          share: 0.5,
          ratePerHour: 4000,
        },
      ],
    },
    {
      id: 'team',
      label: '+1 архитектор',
      changes: [
        {
          type: 'team',
          role: 'architect',
          headcountDelta: 1,
          from: '2026-03-02',
          to: '2026-03-15',
          costPerHour: 1000,
        },
      ],
    },
  ]);

  it('базовый план перегружен; варианты сравниваются по концу, перегрузу и стоимости', () => {
    const snapshot = JSON.stringify(base);
    const out = compareVariants({ base, plans: new Map([['c1', p]]), variants });
    expect(JSON.stringify(base)).toBe(snapshot); // входы не меняются

    expect(out.baseline.overWeeks).toBeGreaterThan(0);
    const [shift, contractor, team] = out.variants;

    // Сдвиг перестраивает Гант по календарю: праздник 11.03 в исходном окне,
    // в новом (с 16.03) праздника нет — этап на рабочий день короче:
    // база кончается в пн 16.03, вариант — в пт 27.03 (+11, а не +14 дней).
    expect(out.baseline.ends[0].endDate).toBe('2026-03-16T15:00:00.000Z');
    expect(shift.ends[0].endDate).toBe('2026-03-27T15:00:00.000Z');
    expect(shift.ends[0].deltaDays).toBe(11);
    expect(shift.costDelta).toBeNull();

    // Подрядчик забирает половину часов роли: перегруз меньше, стоимость — разница ставок.
    expect(contractor.contractorHours).toBe(30);
    expect(contractor.costDelta).toBe(30 * (4000 - 5000));
    expect(contractor.overWeeks).toBeLessThan(out.baseline.overWeeks);
    expect(contractor.ends[0].deltaDays).toBe(0);

    // Команда +1 на две недели: ёмкость растёт (неделя с праздником — на 4/5).
    expect(team.overWeeks).toBeLessThan(out.baseline.overWeeks);
    expect(team.costDelta).toBe(Math.round((20 + 16) * 1000));
    const teamCell = team.matrix.roles[0].cells[1];
    expect(teamCell.capacityHours).toBe(32);
  });

  it('временное изменение ёмкости — со знаком и масштабируется календарём', () => {
    const row = capacity('architect', 1, 30);
    const ctx = {
      adjustments: [
        { role: 'architect', from: d('2026-03-02'), to: d('2026-03-08'), hoursPerWeek: -10 },
      ],
    };
    expect(capacityFor('architect', d('2026-03-02'), [row], ctx)).toBe(20);
    expect(capacityFor('architect', d('2026-03-09'), [row], ctx)).toBe(30);
    // Роль без ёмкости, но с временным усилением — ёмкость с нуля.
    expect(
      capacityFor('analyst', d('2026-03-02'), [], {
        adjustments: [
          { role: 'analyst', from: d('2026-03-02'), to: d('2026-03-08'), hoursPerWeek: 30 },
        ],
      }),
    ).toBe(30);
    expect(capacityFor('analyst', d('2026-03-02'), [], {})).toBeNull();
  });

  it('разбор вариантов отклоняет неверные изменения', () => {
    expect(() => parseVariants([])).toThrow();
    expect(() => parseVariants([{ changes: [] }])).toThrow(/нет изменений/);
    expect(() => parseVariants([{ changes: [{ type: 'magic' }] }])).toThrow(/тип/);
    expect(() =>
      parseVariants([
        { changes: [{ type: 'contractor', calculationId: 'c', role: 'x', share: 2 }] },
      ]),
    ).toThrow(/доля/);
    expect(() =>
      parseVariants([
        {
          changes: [
            {
              type: 'team',
              role: 'customer',
              headcountDelta: 1,
              from: '2026-03-02',
              to: '2026-03-09',
            },
          ],
        },
      ]),
    ).toThrow(/роль/);
    expect(() =>
      parseVariants([
        {
          changes: [
            {
              type: 'team',
              role: 'engineer',
              headcountDelta: 1,
              from: '2026-03-09',
              to: '2026-03-02',
            },
          ],
        },
      ]),
    ).toThrow(/from ≤ to/);
    expect(() =>
      parseVariants([{ changes: [{ type: 'shift', calculationId: 'c', shiftDays: 400 }] }]),
    ).toThrow(/365/);
    expect(() =>
      parseVariants(
        Array.from({ length: 6 }, () => ({
          changes: [{ type: 'shift', calculationId: 'c', shiftDays: 1 }],
        })),
      ),
    ).toThrow(/5/);
  });
});
