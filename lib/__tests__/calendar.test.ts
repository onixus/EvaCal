import { afterEach, describe, expect, it } from 'vitest';
import {
  buildWorkCalendar,
  dayFactor,
  parseDateKey,
  parseWeekendDays,
  STANDARD_CALENDAR,
  weekCapacityFactor,
  type WorkCalendar,
} from '../calendar';
import {
  expandWithApprovals,
  scheduleItems,
  workHoursOn,
  type ScheduleConfig,
  type StagePlanItem,
} from '../scheduling';
import {
  buildCapacityMatrix,
  capacityFor,
  spreadStageByDay,
  spreadStageByWeek,
  type CapacityCalcRow,
} from '../capacity';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const at = (s: string) => new Date(`${s}Z`);

const stage = (hours: number, over: Partial<StagePlanItem> = {}): StagePlanItem => ({
  name: 'Этап',
  role: 'engineer',
  hours,
  isApprovalTask: false,
  requirements: null,
  parallel: false,
  approvalDays: null,
  ...over,
});

const config = (calendar?: WorkCalendar, over: Partial<ScheduleConfig> = {}): ScheduleConfig => ({
  workDayHours: 6,
  includeWeekends: false,
  calendar,
  ...over,
});

/** Часы Ганта по дням: пересечение интервала этапа с рабочим окном 09:00–09:00+h UTC. */
function ganttHoursByDay(start: Date, end: Date, cfg: ScheduleConfig): Map<string, number> {
  const out = new Map<string, number>();
  for (let day = d(start.toISOString().slice(0, 10)); day <= end; day = new Date(+day + 864e5)) {
    const winStart = +day + 9 * 3600e3;
    const winEnd = winStart + workHoursOn(day, cfg) * 3600e3;
    const hours = (Math.min(winEnd, +end) - Math.max(winStart, +start)) / 3600e3;
    if (hours > 0) out.set(day.toISOString().slice(0, 10), hours);
  }
  return out;
}

// 2026-03-02 — понедельник.
const holidayWed = buildWorkCalendar({ exceptions: [{ date: '2026-03-04', kind: 'holiday' }] });

describe('календарь: доля рабочего дня', () => {
  it('стандарт: пн–пт рабочие, сб/вс — нет; includeWeekends делает выходные рабочими', () => {
    expect(dayFactor(d('2026-03-06'))).toBe(1);
    expect(dayFactor(d('2026-03-07'))).toBe(0);
    expect(dayFactor(d('2026-03-08'), STANDARD_CALENDAR, true)).toBe(1);
  });

  it('праздник сильнее includeWeekends, перенос делает субботу рабочей, сокращённый день — доля', () => {
    const cal = buildWorkCalendar({
      exceptions: [
        { date: '2026-03-04', kind: 'holiday' },
        { date: '2026-03-07', kind: 'workday' },
        { date: '2026-03-05', kind: 'short', hours: 4 },
        { date: '2026-03-06', kind: 'short' },
        { date: 'garbage', kind: 'holiday' },
        { date: '2026-03-09', kind: 'unknown' },
      ],
    });
    expect(dayFactor(d('2026-03-04'), cal, true)).toBe(0);
    expect(dayFactor(d('2026-03-07'), cal)).toBe(1);
    expect(dayFactor(d('2026-03-05'), cal)).toBe(0.5);
    expect(dayFactor(d('2026-03-06'), cal)).toBe(7 / 8);
    expect(dayFactor(d('2026-03-09'), cal)).toBe(1);
    expect(cal.exceptions.size).toBe(4);
  });

  it('выходные дни недели настраиваются, но все семь выходными быть не могут', () => {
    expect(parseWeekendDays('7,5, 5,x')).toEqual([5, 7]);
    expect(parseWeekendDays('1,2,3,4,5,6,7')).toEqual([6, 7]);
    const friSat = buildWorkCalendar({ weekendDays: '5,6' });
    expect(dayFactor(d('2026-03-06'), friSat)).toBe(0); // пятница
    expect(dayFactor(d('2026-03-08'), friSat)).toBe(1); // воскресенье
    expect(parseDateKey('2026-02-30')).toBeNull();
  });

  it('доля ёмкости недели: праздник −1/5, рабочая суббота +1/5', () => {
    expect(weekCapacityFactor(d('2026-03-02'))).toBe(1);
    expect(weekCapacityFactor(d('2026-03-02'), holidayWed)).toBe(0.8);
    const sat = buildWorkCalendar({ exceptions: [{ date: '2026-03-07', kind: 'workday' }] });
    expect(weekCapacityFactor(d('2026-03-02'), sat)).toBe(1.2);
  });
});

describe('Гант по календарю (UTC)', () => {
  it('без исключений — прежнее поведение: 09:00 UTC, 6 ч в день, выходные пропускаются', () => {
    // Пт 6.03, 12 ч: пт 6 ч, сб/вс пропуск, пн 6 ч → пн 15:00.
    const [s] = scheduleItems([stage(12)], d('2026-03-06'), config());
    expect(s.startDate.toISOString()).toBe('2026-03-06T09:00:00.000Z');
    expect(s.endDate.toISOString()).toBe('2026-03-09T15:00:00.000Z');
    const same = scheduleItems([stage(12)], d('2026-03-06'), config(buildWorkCalendar({})));
    expect(same[0].endDate.toISOString()).toBe(s.endDate.toISOString());
  });

  it('праздник сдвигает окончание этапа и согласования', () => {
    const plain = scheduleItems([stage(24)], d('2026-03-02'), config());
    expect(plain[0].endDate.toISOString()).toBe('2026-03-05T15:00:00.000Z');
    const withHoliday = scheduleItems([stage(24)], d('2026-03-02'), config(holidayWed));
    expect(withHoliday[0].endDate.toISOString()).toBe('2026-03-06T15:00:00.000Z');

    const items = expandWithApprovals([{ name: 'ТЗ', role: 'analyst', hours: 6, approvalDays: 2 }]);
    const approval = scheduleItems(items, d('2026-03-02'), config(holidayWed))[1];
    expect(approval.isApprovalTask).toBe(true);
    // Этап кончается в пн 15:00 → отсчёт со вт 09:00, +2 рабочих дня: (ср праздник), чт, пт.
    expect(approval.endDate.toISOString()).toBe('2026-03-06T09:00:00.000Z');
    const noHoliday = scheduleItems(items, d('2026-03-02'), config())[1];
    expect(noHoliday.endDate.toISOString()).toBe('2026-03-05T09:00:00.000Z');
  });

  it('сокращённый день даёт меньше часов', () => {
    const cal = buildWorkCalendar({
      exceptions: [{ date: '2026-03-03', kind: 'short', hours: 4 }],
    });
    expect(workHoursOn(d('2026-03-03'), config(cal))).toBe(3);
    // пн 6 + вт 3 + ср 6 = 15 ч → ср 15:00; без календаря — ср 12:00.
    expect(scheduleItems([stage(15)], d('2026-03-02'), config(cal))[0].endDate.toISOString()).toBe(
      '2026-03-04T15:00:00.000Z',
    );
    expect(scheduleItems([stage(15)], d('2026-03-02'), config())[0].endDate.toISOString()).toBe(
      '2026-03-04T12:00:00.000Z',
    );
  });

  it('рабочая суббота используется', () => {
    const cal = buildWorkCalendar({ exceptions: [{ date: '2026-03-07', kind: 'workday' }] });
    const [s] = scheduleItems([stage(12)], at('2026-03-06T09:00:00'), config(cal));
    expect(s.endDate.toISOString()).toBe('2026-03-07T15:00:00.000Z');
  });
});

describe('Гант и ресурсный план согласованы', () => {
  it('один и тот же праздник: часы этапа по дням совпадают', () => {
    const cfg = config(holidayWed);
    const [s] = scheduleItems([stage(24)], d('2026-03-02'), cfg);
    const gantt = ganttHoursByDay(s.startDate, s.endDate, cfg);
    const plan = spreadStageByDay(s, cfg.includeWeekends, holidayWed);
    expect([...plan.entries()]).toEqual([...gantt.entries()]);
    expect(plan.has('2026-03-04')).toBe(false);
    expect([...plan.values()].reduce((a, b) => a + b, 0)).toBe(24);
  });

  it('сокращённый день: план кладёт на него ту же долю, что и Гант', () => {
    const cal = buildWorkCalendar({
      exceptions: [{ date: '2026-03-03', kind: 'short', hours: 4 }],
    });
    const cfg = config(cal);
    const [s] = scheduleItems([stage(15)], d('2026-03-02'), cfg);
    const gantt = ganttHoursByDay(s.startDate, s.endDate, cfg);
    const plan = spreadStageByDay(s, false, cal);
    expect([...plan.entries()]).toEqual([...gantt.entries()]);
    expect(plan.get('2026-03-03')).toBe(3);
  });

  it('матрица использует календарь расчёта: часы праздничной недели не теряются', () => {
    const [s] = scheduleItems([stage(24)], d('2026-03-02'), config(holidayWed));
    const calc: CapacityCalcRow = {
      id: 'c1',
      name: 'Calc',
      version: 1,
      status: 'approved',
      projectId: 'p1',
      projectName: 'P',
      dealStatus: 'won',
      wonCalculationId: 'c1',
      projectStatus: 'active',
      includeWeekends: false,
      calendar: holidayWed,
      stages: [{ ...s, isApprovalTask: false }],
    };
    const m = buildCapacityMatrix({
      calcs: [calc],
      capacities: [
        { role: 'engineer', headcount: 1, hoursPerWeek: 30, effectiveFrom: d('2026-01-01') },
      ],
      from: d('2026-03-02'),
      weeks: 1,
      calendar: holidayWed,
    });
    const cell = m.roles[0].cells[0];
    expect(cell.firmHours).toBe(24);
    expect(cell.capacityHours).toBe(24); // 30 × 4/5
    expect(cell.firmUtil).toBe(1);
    expect(spreadStageByWeek(s, false, holidayWed).get('2026-03-02')).toBe(24);
  });
});

describe('резервы ролей', () => {
  const caps = [
    { role: 'engineer', headcount: 2, hoursPerWeek: 30, effectiveFrom: d('2026-01-01') },
  ];

  it('без резервов и исключений ёмкость прежняя', () => {
    expect(capacityFor('engineer', d('2026-03-02'), caps)).toBe(60);
    expect(capacityFor('engineer', d('2026-03-02'), caps, { calendar: STANDARD_CALENDAR })).toBe(
      60,
    );
  });

  it('резерв уменьшает ёмкость; частичная неделя — пропорционально рабочим дням', () => {
    const reservations = [
      { role: 'engineer', from: d('2026-03-02'), to: d('2026-03-15'), hoursPerWeek: 10 },
      { role: 'analyst', from: d('2026-03-02'), to: d('2026-03-15'), hoursPerWeek: 99 },
    ];
    expect(capacityFor('engineer', d('2026-03-02'), caps, { reservations })).toBe(50);
    const partial = [{ ...reservations[0], from: d('2026-03-09'), to: d('2026-03-10') }];
    expect(capacityFor('engineer', d('2026-03-09'), caps, { reservations: partial })).toBe(56);
    expect(capacityFor('engineer', d('2026-03-16'), caps, { reservations })).toBe(60);
    const huge = [{ ...reservations[0], hoursPerWeek: 400 }];
    expect(capacityFor('engineer', d('2026-03-02'), caps, { reservations: huge })).toBe(0);
  });

  it('праздник уменьшает и ёмкость, и резерв; матрица показывает резерв в ячейке', () => {
    const reservations = [
      { role: 'engineer', from: d('2026-03-02'), to: d('2026-03-08'), hoursPerWeek: 10 },
    ];
    // 60 × 0.8 − 10 × 0.8 = 40
    expect(
      capacityFor('engineer', d('2026-03-02'), caps, { calendar: holidayWed, reservations }),
    ).toBe(40);
    const m = buildCapacityMatrix({
      calcs: [],
      capacities: caps,
      from: d('2026-03-02'),
      weeks: 2,
      calendar: holidayWed,
      reservations,
    });
    expect(m.roles[0].cells.map((c) => [c.capacityHours, c.reservedHours])).toEqual([
      [40, 8],
      [60, 0],
    ]);
  });
});

describe('независимость от часового пояса сервера', () => {
  const original = process.env.TZ;
  afterEach(() => {
    process.env.TZ = original;
  });

  it('Гант и раскладка одинаковы в UTC, Лос-Анджелесе и Москве', () => {
    const run = () => {
      const items = expandWithApprovals([
        { name: 'А', role: 'analyst', hours: 20 },
        { name: 'Б', role: 'engineer', hours: 13, parallel: true },
      ]);
      const scheduled = scheduleItems(items, at('2026-03-06T23:30:00'), config(holidayWed));
      return {
        dates: scheduled.map((s) => [s.startDate.toISOString(), s.endDate.toISOString()]),
        spread: scheduled.map((s) => [...spreadStageByDay(s, false, holidayWed).entries()]),
      };
    };
    const results = ['UTC', 'America/Los_Angeles', 'Europe/Moscow', 'Asia/Kamchatka'].map((tz) => {
      process.env.TZ = tz;
      return run();
    });
    for (const r of results.slice(1)) expect(r).toEqual(results[0]);
    // Пт 23:30 UTC — после рабочего окна: старт в пн 09:00 UTC в любом поясе.
    expect(results[0].dates[0][0]).toBe('2026-03-09T09:00:00.000Z');
  });
});
