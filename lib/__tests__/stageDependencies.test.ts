import { describe, expect, it } from 'vitest';
import { buildWorkCalendar, type WorkCalendar } from '../calendar';
import {
  addLagDays,
  expandWithApprovals,
  findDependencyCycle,
  scheduleItems,
  scheduleWithDependencies,
  validateDependencies,
  type IndexedDependency,
  type PrimaryStageInput,
  type ScheduleConfig,
  type StagePlanItem,
} from '../scheduling';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (x: Date) => x.toISOString();
const cfg = (calendar?: WorkCalendar, over: Partial<ScheduleConfig> = {}): ScheduleConfig => ({
  workDayHours: 6,
  includeWeekends: false,
  calendar,
  ...over,
});
const stage = (name: string, hours: number, over: Partial<StagePlanItem> = {}): StagePlanItem => ({
  name,
  role: 'architect', // без согласования заказчиком
  hours,
  isApprovalTask: false,
  requirements: null,
  parallel: false,
  approvalDays: null,
  ...over,
});
const fs = (from: number, to: number, lagDays = 0): IndexedDependency => ({
  from,
  to,
  type: 'FS',
  lagDays,
});

// 2026-03-02 — понедельник.
const MON = d('2026-03-02');

describe('зависимости этапов: без зависимостей — прежний Гант', () => {
  // Детерминированный генератор, чтобы перебрать много планов без флаки.
  function rng(seed: number) {
    let s = seed;
    return () => {
      s = (s * 1103515245 + 12345) % 2 ** 31;
      return s / 2 ** 31;
    };
  }
  const roles = ['architect', 'analyst', 'engineer', 'developer', 'consultant'];
  const calendars: (WorkCalendar | undefined)[] = [
    undefined,
    buildWorkCalendar({
      exceptions: [
        { date: '2026-03-04', kind: 'holiday' },
        { date: '2026-03-07', kind: 'workday' },
        { date: '2026-03-10', kind: 'short', hours: 4 },
      ],
    }),
  ];

  it('граф ограничений совпадает с прежним алгоритмом на 200 случайных планах', () => {
    const rand = rng(42);
    for (let n = 0; n < 200; n++) {
      const primary: PrimaryStageInput[] = Array.from(
        { length: 1 + Math.floor(rand() * 7) },
        (_, i) => ({
          name: `S${i}`,
          role: roles[Math.floor(rand() * roles.length)],
          hours: Math.floor(rand() * 30),
          parallel: rand() < 0.35,
          approvalDays: rand() < 0.3 ? 1 + Math.floor(rand() * 4) : null,
        }),
      );
      const items = expandWithApprovals(primary);
      const start = new Date(+MON + Math.floor(rand() * 7 * 24) * 3600e3);
      const config = cfg(calendars[n % 2], {
        workDayHours: 4 + (n % 3),
        includeWeekends: n % 5 === 0,
      });
      const legacy = scheduleItems(items, start, config);
      const graph = scheduleWithDependencies(items, start, config, []);
      expect(
        graph.map((s) => [iso(s.startDate), iso(s.endDate), s.dueDate && iso(s.dueDate)]),
      ).toEqual(legacy.map((s) => [iso(s.startDate), iso(s.endDate), s.dueDate && iso(s.dueDate)]));
    }
  });

  it('пустой список зависимостей не меняет результат scheduleItems', () => {
    const items = [stage('A', 12), stage('B', 6, { parallel: true }), stage('C', 6)];
    expect(scheduleItems(items, MON, cfg(), [])).toEqual(scheduleItems(items, MON, cfg()));
  });
});

describe('зависимости этапов: FS с паузой', () => {
  const items = [stage('A', 12), stage('B', 6), stage('C', 6)];

  it('без зависимостей — цепочка A → B → C', () => {
    const [a, b, c] = scheduleItems(items, MON, cfg());
    expect(iso(a.endDate)).toBe('2026-03-03T15:00:00.000Z');
    expect(iso(b.endDate)).toBe('2026-03-04T15:00:00.000Z');
    expect(iso(c.endDate)).toBe('2026-03-05T15:00:00.000Z');
  });

  it('C зависит только от A с паузой 2 рабочих дня: ср и чт — пауза, старт в пт', () => {
    const [, b, c] = scheduleItems(items, MON, cfg(), [fs(0, 2, 2)]);
    expect(iso(b.endDate)).toBe('2026-03-04T15:00:00.000Z'); // B — по-прежнему за A
    expect(iso(c.startDate)).toBe('2026-03-06T09:00:00.000Z');
    expect(iso(c.endDate)).toBe('2026-03-06T15:00:00.000Z');
  });

  it('пауза считается по производственному календарю: праздник в чт её удлиняет', () => {
    const cal = buildWorkCalendar({ exceptions: [{ date: '2026-03-05', kind: 'holiday' }] });
    const [, , c] = scheduleItems(items, MON, cfg(cal), [fs(0, 2, 2)]);
    // Пауза: ср, (чт праздник), пт → старт в пн 9.03.
    expect(iso(c.startDate)).toBe('2026-03-09T09:00:00.000Z');
  });

  it('пауза 0 — сразу после предшественника; этап может начаться раньше неявной цепочки', () => {
    const [, b, c] = scheduleItems(items, MON, cfg(), [fs(0, 2, 0)]);
    expect(iso(c.startDate)).toBe(iso(b.startDate));
    expect(iso(c.endDate)).toBe('2026-03-04T15:00:00.000Z');
  });

  it('этап без явных зависимостей после зависимого ждёт всех предыдущих', () => {
    const four = [...items, stage('D', 6)];
    const [, , c, dd] = scheduleItems(four, MON, cfg(), [fs(0, 2, 2)]);
    expect(iso(dd.startDate)).toBe(iso(c.endDate));
  });

  it('предшественник завершён только вместе с согласованием заказчиком', () => {
    const plan = expandWithApprovals([
      { name: 'ТЗ', role: 'analyst', hours: 6, approvalDays: 2 },
      { name: 'Схема', role: 'architect', hours: 6 },
      { name: 'Монтаж', role: 'architect', hours: 6 },
    ]);
    // [0] ТЗ, [1] согласование ТЗ, [2] Схема, [3] Монтаж; Монтаж ← ТЗ.
    const out = scheduleItems(plan, MON, cfg(), [fs(0, 3, 0)]);
    expect(iso(out[1].endDate)).toBe('2026-03-05T09:00:00.000Z');
    expect(iso(out[3].startDate)).toBe('2026-03-05T09:00:00.000Z');
  });

  it('параллельный этап стартует вместе с этапом, у которого явная зависимость', () => {
    const plan = [stage('A', 12), stage('B', 6), stage('C', 6), stage('P', 3, { parallel: true })];
    const out = scheduleItems(plan, MON, cfg(), [fs(0, 2, 2)]);
    expect(iso(out[3].startDate)).toBe(iso(out[2].startDate));
  });

  it('addLagDays: конец в середине дня — этот день паузой не считается', () => {
    const mid = new Date('2026-03-02T12:00:00Z');
    expect(iso(addLagDays(mid, 1, cfg()))).toBe('2026-03-04T09:00:00.000Z');
    expect(addLagDays(mid, 0, cfg())).toBe(mid);
  });
});

describe('зависимости этапов: проверки', () => {
  const plan = expandWithApprovals([
    { name: 'A', role: 'architect', hours: 6 },
    { name: 'B', role: 'analyst', hours: 6 },
    { name: 'C', role: 'architect', hours: 6 },
  ]);
  // [0] A, [1] B, [2] согласование B, [3] C

  it('цикл отклоняется: зависимость «назад» замыкается на неявную цепочку', () => {
    const issue = validateDependencies(plan, [fs(3, 1)]);
    expect(issue?.code).toBe('cycle');
    expect(issue?.message).toContain('«B»');
    expect(findDependencyCycle(plan, [fs(3, 1)])).not.toBeNull();
    expect(() => scheduleItems(plan, MON, cfg(), [fs(3, 1)])).toThrow(/цикл/);
  });

  it('цикл из явных зависимостей отклоняется', () => {
    const issue = validateDependencies(plan, [fs(0, 3), fs(3, 0)]);
    expect(issue?.code).toBe('cycle');
  });

  it('петля, согласование, дубль, тип и пауза', () => {
    expect(validateDependencies(plan, [fs(0, 0)])?.code).toBe('self');
    expect(validateDependencies(plan, [fs(0, 2)])?.code).toBe('not_primary');
    expect(validateDependencies(plan, [fs(0, 9)])?.code).toBe('not_primary');
    expect(validateDependencies(plan, [fs(0, 3), fs(0, 3, 1)])?.code).toBe('duplicate');
    expect(validateDependencies(plan, [fs(0, 3, -1)])?.code).toBe('bad_lag');
    expect(validateDependencies(plan, [fs(0, 3, 1.5)])?.code).toBe('bad_lag');
    expect(
      validateDependencies(plan, [{ from: 0, to: 3, type: 'SS' as 'FS', lagDays: 0 }])?.code,
    ).toBe('bad_type');
    expect(validateDependencies(plan, [fs(0, 3, 5), fs(1, 3)])).toBeNull();
  });
});
