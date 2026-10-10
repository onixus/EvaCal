import { APPROVAL_BUSINESS_DAYS, APPROVAL_REQUIRED_ROLES, Role } from './roles';
import {
  addUtcDays,
  dayFactor,
  DAY_MS,
  STANDARD_CALENDAR,
  utcDay,
  type WorkCalendar,
} from './calendar';

/** Начало рабочего дня, часов UTC. Весь расчёт Ганта — в UTC (см. lib/calendar.ts). */
const WORK_START_HOUR = 9;
const HOUR_MS = 3600000;

export const MIN_WORK_DAY_HOURS = 4;
export const MAX_WORK_DAY_HOURS = 6;

export interface ScheduleConfig {
  workDayHours: number; // 4-6, length of a working day starting at 09:00 UTC
  includeWeekends: boolean; // if true, the calendar's weekend days count as working days too
  /** Производственный календарь; без него — сб/вс выходные, исключений нет. */
  calendar?: WorkCalendar;
}

export const DEFAULT_SCHEDULE_CONFIG: ScheduleConfig = {
  workDayHours: 6,
  includeWeekends: false,
};

/** Защита от бесконечного цикла на вырожденном календаре (≈ 10 лет без рабочих дней). */
const MAX_SKIPPED_DAYS = 3660;

export function clampWorkDayHours(hours: number): number {
  if (!Number.isFinite(hours)) return DEFAULT_SCHEDULE_CONFIG.workDayHours;
  return Math.min(MAX_WORK_DAY_HOURS, Math.max(MIN_WORK_DAY_HOURS, Math.round(hours)));
}

/** Длина рабочего окна дня в часах с учётом выходных, праздников и сокращённых дней. */
export function workHoursOn(d: Date, config: ScheduleConfig): number {
  return (
    config.workDayHours * dayFactor(d, config.calendar ?? STANDARD_CALENDAR, config.includeWeekends)
  );
}

function dayStart(d: Date): Date {
  return new Date(utcDay(d).getTime() + WORK_START_HOUR * HOUR_MS);
}

function dayEnd(d: Date, config: ScheduleConfig): Date {
  return new Date(dayStart(d).getTime() + workHoursOn(d, config) * HOUR_MS);
}

function nextDayStart(d: Date): Date {
  return dayStart(addUtcDays(utcDay(d), 1));
}

/** Rolls a moment forward to the next point inside the configured working window. */
function nextWorkMoment(d: Date, config: ScheduleConfig): Date {
  let result = new Date(d);
  for (let guard = 0; guard <= MAX_SKIPPED_DAYS; guard++) {
    if (workHoursOn(result, config) <= 0) {
      result = nextDayStart(result);
      continue;
    }
    const start = dayStart(result);
    if (result.getTime() < start.getTime()) return start;
    if (result.getTime() >= dayEnd(result, config).getTime()) {
      result = nextDayStart(result);
      continue;
    }
    return result;
  }
  throw new Error('Календарь не содержит рабочих дней');
}

/** Advances `hours` of actual work time from `start`, skipping nights/weekends/holidays. */
function addWorkHours(start: Date, hours: number, config: ScheduleConfig): Date {
  let cursor = nextWorkMoment(start, config);
  let remaining = hours;
  while (remaining > 0) {
    const availableHours = (dayEnd(cursor, config).getTime() - cursor.getTime()) / HOUR_MS;
    if (availableHours >= remaining) {
      cursor = new Date(cursor.getTime() + remaining * HOUR_MS);
      remaining = 0;
    } else {
      remaining -= availableHours;
      cursor = nextWorkMoment(nextDayStart(cursor), config);
    }
  }
  return cursor;
}

/** Advances `days` whole business days (used for the customer approval SLA). */
function addBusinessDays(start: Date, days: number, config: ScheduleConfig): Date {
  let cursor = nextWorkMoment(start, config);
  let count = 0;
  let guard = 0;
  while (count < days) {
    cursor = new Date(cursor.getTime() + DAY_MS);
    if (workHoursOn(cursor, config) > 0) count++;
    if (++guard > MAX_SKIPPED_DAYS + days) throw new Error('Календарь не содержит рабочих дней');
  }
  // Срок не может выпасть за рабочее окно дня: у сокращённого дня оно кончается раньше.
  const end = dayEnd(cursor, config);
  return cursor.getTime() > end.getTime() ? end : cursor;
}

export interface PrimaryStageInput {
  name: string;
  role: string;
  hours: number;
  requirements?: string | null;
  /** Starts alongside the preceding non-parallel stage instead of after it. */
  parallel?: boolean;
  /** Custom duration (business days) for this stage's own approval task; defaults to APPROVAL_BUSINESS_DAYS. */
  approvalDays?: number | null;
}

export interface StagePlanItem {
  name: string;
  role: string;
  hours: number;
  isApprovalTask: boolean;
  requirements: string | null;
  parallel: boolean;
  approvalDays: number | null;
}

export interface ScheduledItem extends StagePlanItem {
  order: number;
  startDate: Date;
  endDate: Date;
  dueDate: Date | null;
}

/** Inserts an automatic customer approval task after every stage run by a role that requires sign-off. */
export function expandWithApprovals(primary: PrimaryStageInput[]): StagePlanItem[] {
  const items: StagePlanItem[] = [];
  for (const p of primary) {
    items.push({
      name: p.name,
      role: p.role,
      hours: Math.max(0, p.hours),
      isApprovalTask: false,
      requirements: p.requirements ?? null,
      parallel: !!p.parallel,
      approvalDays: null,
    });
    if (APPROVAL_REQUIRED_ROLES.includes(p.role as Role)) {
      items.push({
        name: `Согласование заказчиком: «${p.name}»`,
        role: 'customer',
        hours: 0,
        isApprovalTask: true,
        requirements: null,
        parallel: false,
        approvalDays: p.approvalDays ?? null,
      });
    }
  }
  return items;
}

/**
 * Lays out the Gantt: each item starts right after the previous one ends, unless it's
 * flagged `parallel`, in which case it starts alongside the preceding non-parallel stage.
 * A stage's own approval task always anchors to that stage's end. The next non-parallel
 * stage waits for every item in the current parallel batch (including approvals) to finish.
 */
export function scheduleItems(
  items: StagePlanItem[],
  startDate: Date,
  config: ScheduleConfig = DEFAULT_SCHEDULE_CONFIG,
): ScheduledItem[] {
  let cursor = nextWorkMoment(startDate, config); // where the next non-parallel stage may start
  let anchorStart = cursor; // start time shared by any stage flagged parallel
  let lastStageEnd = cursor; // end of the most recent primary stage, for its own approval task

  return items.map((item, index) => {
    let start: Date;
    if (item.isApprovalTask) {
      start = lastStageEnd;
    } else if (item.parallel) {
      start = anchorStart;
    } else {
      start = cursor;
      anchorStart = start;
    }

    const end = item.isApprovalTask
      ? addBusinessDays(start, item.approvalDays ?? APPROVAL_BUSINESS_DAYS, config)
      : item.hours > 0
        ? addWorkHours(start, item.hours, config)
        : start;

    if (!item.isApprovalTask) lastStageEnd = end;
    if (end > cursor) cursor = end;

    return {
      ...item,
      order: index,
      startDate: start,
      endDate: end,
      dueDate: item.isApprovalTask ? end : null,
    };
  });
}

export function totalLaborHours(items: { hours: number; isApprovalTask: boolean }[]): number {
  return items.filter((i) => !i.isApprovalTask).reduce((sum, i) => sum + i.hours, 0);
}
