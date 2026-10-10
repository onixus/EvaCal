/**
 * Выборка и запись для зависимостей этапов, подбора даты старта и вариантов
 * плана (#103 WP-5e). Логика — в `lib/scheduling.ts` и `lib/planning.ts`.
 */
import { prisma } from '@/lib/prisma';
import { buildCapacityMatrix, weekStart } from '@/lib/capacity';
import { calendarFor, loadCalendarSet, type CalendarSet } from '@/lib/calendarData';
import { DEFAULT_WEEKS, loadCapacityRows, MAX_WEEKS, type CapacityQuery } from '@/lib/capacityData';
import {
  compareVariants,
  demandFromMatrix,
  findEarliestStart,
  reschedulePlan,
  variantCalculationIds,
  type CalcPlan,
  type EarliestStartResult,
  type PlanVariant,
  type VariantComparison,
} from '@/lib/planning';
import {
  validateDependencies,
  type IndexedDependency,
  type ScheduledItem,
  type StagePlanItem,
} from '@/lib/scheduling';

const planSelect = {
  id: true,
  name: true,
  startDate: true,
  roleRates: true,
  status: true,
  projectId: true,
  template: { select: { workDayHours: true, includeWeekends: true, calendarId: true } },
  stages: {
    orderBy: { order: 'asc' },
    select: {
      id: true,
      name: true,
      role: true,
      hours: true,
      isApprovalTask: true,
      requirements: true,
      parallel: true,
      approvalDays: true,
    },
  },
  stageDependencies: { select: { fromStageId: true, toStageId: true, type: true, lagDays: true } },
} as const;

type PlanRow = {
  id: string;
  name: string;
  startDate: Date;
  roleRates: string | null;
  template: { workDayHours: number; includeWeekends: boolean; calendarId: string | null };
  stages: {
    id: string;
    name: string;
    role: string;
    hours: number;
    isApprovalTask: boolean;
    requirements: string | null;
    parallel: boolean;
    approvalDays: number | null;
  }[];
  stageDependencies: { fromStageId: string; toStageId: string; type: string; lagDays: number }[];
};

export function toPlan(row: PlanRow, calendars: CalendarSet): CalcPlan {
  const index = new Map(row.stages.map((s, i) => [s.id, i]));
  const items: StagePlanItem[] = row.stages.map((s) => ({
    name: s.name,
    role: s.role,
    hours: s.hours,
    isApprovalTask: s.isApprovalTask,
    requirements: s.requirements,
    parallel: s.parallel,
    approvalDays: s.approvalDays,
  }));
  const dependencies: IndexedDependency[] = [];
  for (const d of row.stageDependencies) {
    const from = index.get(d.fromStageId);
    const to = index.get(d.toStageId);
    if (from === undefined || to === undefined) continue;
    dependencies.push({ from, to, type: 'FS', lagDays: d.lagDays });
  }
  return {
    calculationId: row.id,
    name: row.name,
    startDate: row.startDate,
    items,
    stageIds: row.stages.map((s) => s.id),
    dependencies,
    config: {
      workDayHours: row.template.workDayHours,
      includeWeekends: row.template.includeWeekends,
      calendar: calendarFor(calendars, row.template.calendarId),
    },
    roleRates: row.roleRates,
  };
}

export async function loadCalcPlans(ids: string[]): Promise<Map<string, CalcPlan>> {
  if (ids.length === 0) return new Map();
  const [rows, calendars] = await Promise.all([
    prisma.calculation.findMany({ where: { id: { in: ids } }, select: planSelect }),
    loadCalendarSet(),
  ]);
  return new Map(rows.map((r) => [r.id, toPlan(r, calendars)]));
}

/**
 * Записи, которые перестраивают Гант расчёта на месте (id этапов и внесённый
 * факт сохраняются), по календарю шаблона и зависимостям. Возвращает операции
 * для `prisma.$transaction`, чтобы вызывающий мог добавить свои.
 */
export function rescheduleOps(plan: CalcPlan, startDate: Date) {
  const scheduled: ScheduledItem[] = reschedulePlan(plan, startDate);
  return [
    prisma.calculation.update({ where: { id: plan.calculationId }, data: { startDate } }),
    ...scheduled.map((item, i) =>
      prisma.stage.update({
        where: { id: plan.stageIds[i] },
        data: { startDate: item.startDate, endDate: item.endDate, dueDate: item.dueDate },
      }),
    ),
  ];
}

// ---------------------------------------------------------------------------
// Зависимости этапов
// ---------------------------------------------------------------------------

export interface DependencyInput {
  fromStageId: string;
  toStageId: string;
  type?: string;
  lagDays: number;
}

export class DependencyError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** Разбор тела PUT; бросает DependencyError. */
export function parseDependencyInput(raw: unknown): DependencyInput[] {
  if (!Array.isArray(raw)) throw new DependencyError('dependencies должен быть массивом');
  if (raw.length > 500) throw new DependencyError('Слишком много зависимостей');
  return raw.map((d) => {
    const o = (d ?? {}) as Record<string, unknown>;
    const lag =
      o.lagDays === undefined || o.lagDays === null || o.lagDays === '' ? 0 : Number(o.lagDays);
    return {
      fromStageId: String(o.fromStageId ?? ''),
      toStageId: String(o.toStageId ?? ''),
      type: o.type === undefined ? 'FS' : String(o.type),
      lagDays: lag,
    };
  });
}

/** Перевод зависимостей по id этапов в индексы плана с проверкой (без записи). */
export function indexDependencies(plan: CalcPlan, deps: DependencyInput[]): IndexedDependency[] {
  const index = new Map(plan.stageIds.map((id, i) => [id, i]));
  const indexed = deps.map((d) => {
    const from = index.get(d.fromStageId);
    const to = index.get(d.toStageId);
    if (from === undefined || to === undefined) {
      throw new DependencyError('Этап зависимости не принадлежит расчёту');
    }
    if (d.type !== 'FS') {
      throw new DependencyError('Поддерживается только тип FS (окончание → начало)');
    }
    return { from, to, type: 'FS' as const, lagDays: d.lagDays };
  });
  const issue = validateDependencies(plan.items, indexed);
  if (issue) throw new DependencyError(issue.message, issue.code === 'cycle' ? 409 : 400);
  return indexed;
}

/**
 * Заменяет зависимости расчёта и перестраивает даты этапов на месте одной
 * транзакцией. Циклы и чужие этапы отклоняются до записи.
 */
export async function replaceDependencies(calculationId: string, deps: DependencyInput[]) {
  const plans = await loadCalcPlans([calculationId]);
  const plan = plans.get(calculationId);
  if (!plan) throw new DependencyError('not found', 404);
  const indexed = indexDependencies(plan, deps);
  const next: CalcPlan = { ...plan, dependencies: indexed };
  await prisma.$transaction([
    prisma.stageDependency.deleteMany({ where: { calculationId } }),
    ...indexed.map((d) =>
      prisma.stageDependency.create({
        data: {
          calculationId,
          fromStageId: plan.stageIds[d.from],
          toStageId: plan.stageIds[d.to],
          type: 'FS',
          lagDays: d.lagDays,
        },
      }),
    ),
    ...rescheduleOps(next, plan.startDate),
  ]);
  return indexed.map((d) => ({
    fromStageId: plan.stageIds[d.from],
    toStageId: plan.stageIds[d.to],
    type: 'FS',
    lagDays: d.lagDays,
  }));
}

// ---------------------------------------------------------------------------
// Ближайшая доступная дата старта
// ---------------------------------------------------------------------------

export async function loadEarliestStart(
  calculationId: string,
  opts: { from?: Date; horizonDays?: number; includeDrafts?: boolean } = {},
): Promise<(EarliestStartResult & { currentStartDate: string }) | null> {
  const row = await prisma.calculation.findUnique({
    where: { id: calculationId },
    select: planSelect,
  });
  if (!row) return null;
  const calendars = await loadCalendarSet();
  const plan = toPlan(row, calendars);
  const from = opts.from ?? new Date();
  const horizonDays = Math.max(1, Math.min(366, opts.horizonDays ?? 182));
  // Горизонт плана: окно поиска плюс длительность Ганта.
  const span =
    row.stages.length > 0
      ? reschedulePlan(plan, from).reduce((m, s) => Math.max(m, s.endDate.getTime()), 0) -
        weekStart(from).getTime()
      : 0;
  const weeks = Math.min(
    MAX_WEEKS,
    Math.ceil((horizonDays * 86400000 + Math.max(0, span)) / (7 * 86400000)) + 1,
  );
  const rows = await loadCapacityRows(from, weeks);
  // Остальной спрос — без этого расчёта и других версий того же проекта.
  const others = rows.calcs.filter(
    (c) => c.id !== calculationId && (!row.projectId || c.projectId !== row.projectId),
  );
  const matrix = buildCapacityMatrix({
    calcs: others,
    capacities: rows.capacities,
    from,
    weeks,
    includeDrafts: opts.includeDrafts,
    calendar: rows.calendar,
    reservations: rows.reservations,
  });
  const result = findEarliestStart({
    plan,
    from,
    horizonDays,
    capacities: rows.capacities,
    capacityCalendar: rows.calendar,
    reservations: rows.reservations,
    otherDemand: demandFromMatrix(matrix),
  });
  return { ...result, currentStartDate: row.startDate.toISOString() };
}

// ---------------------------------------------------------------------------
// Варианты what-if
// ---------------------------------------------------------------------------

/** Сравнение вариантов поверх ресурсного плана. Ничего не пишет. */
export async function loadVariantComparison(
  q: CapacityQuery,
  variants: PlanVariant[],
): Promise<VariantComparison> {
  const from = q.from ?? new Date();
  const weeks = q.weeks ?? DEFAULT_WEEKS;
  const ids = variantCalculationIds(variants);
  const [rows, plans] = await Promise.all([
    loadCapacityRows(from, weeks, true, ids),
    loadCalcPlans(ids),
  ]);
  return compareVariants({
    base: {
      calcs: rows.calcs,
      capacities: rows.capacities,
      from,
      weeks,
      includeDrafts: q.includeDrafts,
      roles: q.roles,
      calendar: rows.calendar,
      reservations: rows.reservations,
    },
    plans,
    variants,
  });
}
