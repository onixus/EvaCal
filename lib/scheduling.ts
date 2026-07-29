import { APPROVAL_BUSINESS_DAYS, APPROVAL_REQUIRED_ROLES, Role } from "./roles";

const WORK_START_HOUR = 9;
const WORK_END_HOUR = 18; // flat 9-18 work window

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

/** Rolls a moment forward to the next point inside a working window (Mon-Fri, 09:00-18:00). */
function nextWorkMoment(d: Date): Date {
  let result = new Date(d);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (isWeekend(result)) {
      result = atHour(addDays(result, 1), WORK_START_HOUR);
      continue;
    }
    if (result.getHours() < WORK_START_HOUR) {
      result = atHour(result, WORK_START_HOUR);
      continue;
    }
    if (result.getHours() >= WORK_END_HOUR) {
      result = atHour(addDays(result, 1), WORK_START_HOUR);
      continue;
    }
    return result;
  }
}

/** Advances `hours` of actual work time from `start`, skipping nights and weekends. */
function addWorkHours(start: Date, hours: number): Date {
  let cursor = nextWorkMoment(start);
  let remaining = hours;
  while (remaining > 0) {
    const dayEnd = atHour(cursor, WORK_END_HOUR);
    const availableHours = (dayEnd.getTime() - cursor.getTime()) / 3600000;
    if (availableHours >= remaining) {
      cursor = new Date(cursor.getTime() + remaining * 3600000);
      remaining = 0;
    } else {
      remaining -= availableHours;
      cursor = nextWorkMoment(atHour(addDays(cursor, 1), WORK_START_HOUR));
    }
  }
  return cursor;
}

/** Advances `days` whole business days (used for the 3-day customer approval SLA). */
function addBusinessDays(start: Date, days: number): Date {
  let cursor = nextWorkMoment(start);
  let count = 0;
  while (count < days) {
    cursor = addDays(cursor, 1);
    if (!isWeekend(cursor)) count++;
  }
  return cursor;
}

export interface PrimaryStageInput {
  name: string;
  role: string;
  hours: number;
}

export interface StagePlanItem {
  name: string;
  role: string;
  hours: number;
  isApprovalTask: boolean;
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
    items.push({ name: p.name, role: p.role, hours: Math.max(0, p.hours), isApprovalTask: false });
    if (APPROVAL_REQUIRED_ROLES.includes(p.role as Role)) {
      items.push({
        name: `Согласование заказчиком: «${p.name}»`,
        role: "customer",
        hours: 0,
        isApprovalTask: true,
      });
    }
  }
  return items;
}

/** Lays out a sequential Gantt: each item starts right after the previous one ends. */
export function scheduleItems(items: StagePlanItem[], startDate: Date): ScheduledItem[] {
  let cursor = nextWorkMoment(startDate);
  return items.map((item, index) => {
    if (item.isApprovalTask) {
      const start = cursor;
      const end = addBusinessDays(start, APPROVAL_BUSINESS_DAYS);
      cursor = end;
      return { ...item, order: index, startDate: start, endDate: end, dueDate: end };
    }
    const start = cursor;
    const end = item.hours > 0 ? addWorkHours(start, item.hours) : start;
    cursor = end;
    return { ...item, order: index, startDate: start, endDate: end, dueDate: null };
  });
}

export function totalLaborHours(items: { hours: number; isApprovalTask: boolean }[]): number {
  return items.filter((i) => !i.isApprovalTask).reduce((sum, i) => sum + i.hours, 0);
}
