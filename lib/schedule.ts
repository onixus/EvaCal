/**
 * Контроль сроков проекта (Horizon E3): план против факта по датам этапов.
 * Чистая логика без Prisma: сюда приходят этапы выигранной версии с
 * плановыми и фактическими датами, отсюда — сдвиги и прогноз окончания.
 */

export interface ScheduleStageRow {
  id: string;
  name: string;
  role: string;
  isApprovalTask: boolean;
  startDate: Date;
  endDate: Date;
  actualStartDate: Date | null;
  actualEndDate: Date | null;
}

export type StageScheduleStatus = 'planned' | 'in_progress' | 'done' | 'overdue';

export interface StageSchedule {
  id: string;
  name: string;
  role: string;
  plannedStart: string;
  plannedEnd: string;
  actualStart: string | null;
  actualEnd: string | null;
  /** Сдвиг старта и окончания в днях; > 0 — позже плана. null — факта нет. */
  startSlipDays: number | null;
  endSlipDays: number | null;
  /** Плановая и фактическая длительность, дней (включительно). */
  plannedDays: number;
  actualDays: number | null;
  status: StageScheduleStatus;
  /** Для незавершённых: на сколько дней просрочен план на дату отчёта. */
  overdueDays: number;
}

export type ProjectScheduleStatus = 'not_started' | 'on_track' | 'at_risk' | 'late' | 'completed';

export interface ProjectSchedule {
  stages: StageSchedule[];
  plannedStart: string;
  plannedEnd: string;
  /** Прогноз окончания: план + текущий сдвиг. */
  forecastEnd: string;
  /** Текущий сдвиг, дней: максимум из сдвигов завершённых и просрочек незавершённых. */
  currentSlipDays: number;
  done: number;
  total: number;
  overdue: number;
  status: ProjectScheduleStatus;
  /** Медиана сдвига окончания по завершённым этапам; null — завершённых нет. */
  medianEndSlipDays: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Разница в календарных днях (b − a), по датам без времени. */
export function daysBetween(a: Date, b: Date): number {
  return Math.round((utcDay(b) - utcDay(a)) / DAY_MS);
}

function iso(d: Date): string {
  return new Date(utcDay(d)).toISOString().slice(0, 10);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Порог, после которого сдвиг считается опозданием, а не риском. */
export const LATE_THRESHOLD_DAYS = 5;

export function stageSchedule(s: ScheduleStageRow, today: Date): StageSchedule {
  const plannedDays = daysBetween(s.startDate, s.endDate) + 1;
  const actualDays =
    s.actualStartDate && s.actualEndDate
      ? daysBetween(s.actualStartDate, s.actualEndDate) + 1
      : null;
  let status: StageScheduleStatus = 'planned';
  if (s.actualEndDate) status = 'done';
  else if (utcDay(today) > utcDay(s.endDate)) status = 'overdue';
  else if (s.actualStartDate) status = 'in_progress';
  const overdueDays = status === 'overdue' ? daysBetween(s.endDate, today) : 0;
  return {
    id: s.id,
    name: s.name,
    role: s.role,
    plannedStart: iso(s.startDate),
    plannedEnd: iso(s.endDate),
    actualStart: s.actualStartDate ? iso(s.actualStartDate) : null,
    actualEnd: s.actualEndDate ? iso(s.actualEndDate) : null,
    startSlipDays: s.actualStartDate ? daysBetween(s.startDate, s.actualStartDate) : null,
    endSlipDays: s.actualEndDate ? daysBetween(s.endDate, s.actualEndDate) : null,
    plannedDays,
    actualDays,
    status,
    overdueDays,
  };
}

/**
 * Сводка по проекту. Согласования учитываются в датах плана (они двигают
 * окончание), но не считаются этапами для прогресса.
 */
export function projectSchedule(
  rows: ScheduleStageRow[],
  today: Date = new Date(),
): ProjectSchedule | null {
  if (rows.length === 0) return null;
  const work = rows.filter((r) => !r.isApprovalTask);
  const stages = work.map((s) => stageSchedule(s, today));
  const plannedStart = new Date(Math.min(...rows.map((r) => r.startDate.getTime())));
  const plannedEnd = new Date(Math.max(...rows.map((r) => r.endDate.getTime())));

  const done = stages.filter((s) => s.status === 'done');
  const overdue = stages.filter((s) => s.status === 'overdue');
  const slips = [...done.map((s) => s.endSlipDays ?? 0), ...overdue.map((s) => s.overdueDays)];
  const currentSlipDays = Math.max(0, ...slips);

  let status: ProjectScheduleStatus;
  if (stages.length > 0 && done.length === stages.length) status = 'completed';
  else if (stages.every((s) => s.status === 'planned') && utcDay(today) < utcDay(plannedStart))
    status = 'not_started';
  else if (currentSlipDays > LATE_THRESHOLD_DAYS) status = 'late';
  else if (currentSlipDays > 0) status = 'at_risk';
  else status = 'on_track';

  return {
    stages,
    plannedStart: iso(plannedStart),
    plannedEnd: iso(plannedEnd),
    forecastEnd: iso(new Date(plannedEnd.getTime() + currentSlipDays * DAY_MS)),
    currentSlipDays,
    done: done.length,
    total: stages.length,
    overdue: overdue.length,
    status,
    medianEndSlipDays: median(done.map((s) => s.endSlipDays ?? 0)),
  };
}

export const PROJECT_SCHEDULE_LABELS: Record<ProjectScheduleStatus, string> = {
  not_started: 'Не начат',
  on_track: 'В графике',
  at_risk: 'Риск срыва',
  late: 'Опоздание',
  completed: 'Завершён',
};
