/**
 * Загрузка производственных календарей из БД (#103 WP-5d). Логика дня —
 * в `lib/calendar.ts`; здесь только выборка, чтобы Гант и ресурсный план
 * получали один и тот же календарь.
 */
import { prisma } from '@/lib/prisma';
import { buildWorkCalendar, STANDARD_CALENDAR, type WorkCalendar } from '@/lib/calendar';
import type { ScheduleConfig } from '@/lib/scheduling';
import type { RoleReservationRow } from '@/lib/capacity';

export interface CalendarSet {
  /** Календарь по умолчанию (isDefault); если в БД календарей нет — сб/вс без исключений. */
  defaultCalendar: WorkCalendar;
  defaultId: string | null;
  byId: Map<string, WorkCalendar>;
}

const calendarSelect = {
  id: true,
  isDefault: true,
  weekendDays: true,
  exceptions: { select: { date: true, kind: true, hours: true } },
} as const;

type CalendarRow = {
  id: string;
  isDefault: boolean;
  weekendDays: string;
  exceptions: { date: Date; kind: string; hours: number | null }[];
};

function toCalendar(row: CalendarRow): WorkCalendar {
  return buildWorkCalendar({ weekendDays: row.weekendDays, exceptions: row.exceptions });
}

export async function loadCalendarSet(): Promise<CalendarSet> {
  const rows: CalendarRow[] = await prisma.workCalendar.findMany({ select: calendarSelect });
  const byId = new Map(rows.map((r) => [r.id, toCalendar(r)]));
  const def = rows.find((r) => r.isDefault) ?? null;
  return {
    defaultCalendar: def ? (byId.get(def.id) ?? STANDARD_CALENDAR) : STANDARD_CALENDAR,
    defaultId: def?.id ?? null,
    byId,
  };
}

/** Календарь шаблона, иначе календарь по умолчанию. */
export function calendarFor(set: CalendarSet, calendarId: string | null | undefined): WorkCalendar {
  return (calendarId ? set.byId.get(calendarId) : undefined) ?? set.defaultCalendar;
}

/** Календарь для Ганта одного шаблона: читает только нужную строку. */
export async function loadCalendar(calendarId: string | null | undefined): Promise<WorkCalendar> {
  const row: CalendarRow | null =
    (calendarId
      ? await prisma.workCalendar.findUnique({ where: { id: calendarId }, select: calendarSelect })
      : null) ??
    (await prisma.workCalendar.findFirst({ where: { isDefault: true }, select: calendarSelect }));
  return row ? toCalendar(row) : STANDARD_CALENDAR;
}

/** Настройки Ганта шаблона вместе с его производственным календарём. */
export async function loadScheduleConfig(template: {
  workDayHours: number;
  includeWeekends: boolean;
  calendarId?: string | null;
}): Promise<ScheduleConfig> {
  return {
    workDayHours: template.workDayHours,
    includeWeekends: template.includeWeekends,
    calendar: await loadCalendar(template.calendarId),
  };
}

/** Резервы ролей, пересекающие интервал [from, to]. */
export async function loadReservations(from: Date, to: Date): Promise<RoleReservationRow[]> {
  return prisma.roleReservation.findMany({
    where: { from: { lte: to }, to: { gte: from } },
    select: { role: true, from: true, to: true, hoursPerWeek: true },
  });
}
