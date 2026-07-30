import { APPROVAL_BUSINESS_DAYS, APPROVAL_REQUIRED_ROLES, Role } from "./roles";

const WORK_START_HOUR = 9;

export const MIN_WORK_DAY_HOURS = 4;
export const MAX_WORK_DAY_HOURS = 6;

export interface ScheduleConfig {
  workDayHours: number; // 4-6, length of a working day starting at 09:00
  includeWeekends: boolean; // if true, Saturday/Sunday count as working days too
}

export const DEFAULT_SCHEDULE_CONFIG: ScheduleConfig = { workDayHours: 6, includeWeekends: false };

export function clampWorkDayHours(hours: number): number {
  if (!Number.isFinite(hours)) return DEFAULT_SCHEDULE_CONFIG.workDayHours;
  return Math.min(MAX_WORK_DAY_HOURS, Math.max(MIN_WORK_DAY_HOURS, Math.round(hours)));
}

function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

function addDays(d: Date, days: number): Date {
  const result = new Date(d);
  result.setDate(result.getDate() + days);
  return result;
}

function atHour(d: Date, hour: number): Date {
  const result = new Date(d);
  result.setHours(hour, 0, 0, 0);
  return result;
}

/** Rolls a moment forward to the next point inside the configured working window. */
function nextWorkMoment(d: Date, config: ScheduleConfig): Date {
  const workEndHour = WORK_START_HOUR + config.workDayHours;
  let result = new Date(d);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (!config.includeWeekends && isWeekend(result)) {
      result = atHour(addDays(result, 1), WORK_START_HOUR);
      continue;
    }
    if (result.getHours() < WORK_START_HOUR) {
      result = atHour(result, WORK_START_HOUR);
      continue;
    }
    if (result.getHours() >= workEndHour) {
      result = atHour(addDays(result, 1), WORK_START_HOUR);
      continue;
    }
    return result;
  }
}

/** Advances `hours` of actual work time from `start`, skipping nights/weekends per config. */
function addWorkHours(start: Date, hours: number, config: ScheduleConfig): Date {
  const workEndHour = WORK_START_HOUR + config.workDayHours;
  let cursor = nextWorkMoment(start, config);
  let remaining = hours;
  while (remaining > 0) {
    const dayEnd = atHour(cursor, workEndHour);
    const availableHours = (dayEnd.getTime() - cursor.getTime()) / 3600000;
    if (availableHours >= remaining) {
      cursor = new Date(cursor.getTime() + remaining * 3600000);
      remaining = 0;
    } else {
      remaining -= availableHours;
      cursor = nextWorkMoment(atHour(addDays(cursor, 1), WORK_START_HOUR), config);
    }
  }
  return cursor;
}

/** Advances `days` whole business days (used for the customer approval SLA). */
function addBusinessDays(start: Date, days: number, config: ScheduleConfig): Date {
  let cursor = nextWorkMoment(start, config);
  let count = 0;
  while (count < days) {
    cursor = addDays(cursor, 1);
    if (config.includeWeekends || !isWeekend(cursor)) count++;
  }
  return cursor;
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
        role: "customer",
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
  config: ScheduleConfig = DEFAULT_SCHEDULE_CONFIG
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
