/**
 * Выборка данных ресурсного плана из БД (Horizon E2). Отделена от
 * `lib/capacity.ts`, чтобы раскладку и веса тестировать без Prisma.
 */
import { prisma } from '@/lib/prisma';
import {
  addDays,
  buildCapacityMatrix,
  warningsForCalculation,
  weekStart,
  type CalcShift,
  type CapacityCalcRow,
  type CapacityMatrix,
  type CapacityWarning,
  type RoleCapacityRow,
} from '@/lib/capacity';

export const DEFAULT_WEEKS = 13;
export const MAX_WEEKS = 52;

export interface CapacityQuery {
  from?: Date;
  weeks?: number;
  includeDrafts?: boolean;
  roles?: string[];
  shifts?: CalcShift[];
}

export function parseCapacityQuery(params: URLSearchParams): CapacityQuery {
  const fromRaw = params.get('from');
  const from = fromRaw ? new Date(fromRaw) : undefined;
  const weeksRaw = Number(params.get('weeks'));
  const roles = params
    .get('roles')
    ?.split(',')
    .map((r) => r.trim())
    .filter(Boolean);
  return {
    from: from && !Number.isNaN(from.getTime()) ? from : undefined,
    weeks: Number.isFinite(weeksRaw) && weeksRaw > 0 ? Math.min(MAX_WEEKS, weeksRaw) : undefined,
    includeDrafts: params.get('drafts') === '1',
    roles: roles && roles.length ? roles : undefined,
  };
}

export async function loadCapacityRows(
  from: Date,
  weeks: number,
  withShifts = false,
): Promise<{
  calcs: CapacityCalcRow[];
  capacities: RoleCapacityRow[];
}> {
  const rangeStart = weekStart(from);
  const rangeEnd = addDays(rangeStart, weeks * 7);
  // Сдвиг what-if может притянуть этапы из-за границ диапазона — берём с запасом в горизонт.
  // Без сдвигов what-if запас за границами горизонта только раздувает выборку.
  const pad = withShifts ? weeks * 7 : 0;

  const [calcs, capacities] = await Promise.all([
    prisma.calculation.findMany({
      where: {
        stages: {
          some: {
            startDate: { lte: addDays(rangeEnd, pad) },
            endDate: { gte: addDays(rangeStart, -pad) },
          },
        },
        OR: [
          { project: null },
          {
            project: { status: { not: 'archived' }, dealStatus: { notIn: ['lost', 'cancelled'] } },
          },
        ],
      },
      select: {
        id: true,
        name: true,
        version: true,
        status: true,
        projectId: true,
        template: { select: { includeWeekends: true } },
        project: { select: { name: true, dealStatus: true, wonCalculationId: true, status: true } },
        stages: {
          select: { role: true, hours: true, isApprovalTask: true, startDate: true, endDate: true },
        },
      },
    }),
    prisma.roleCapacity.findMany({
      select: { role: true, headcount: true, hoursPerWeek: true, effectiveFrom: true },
    }),
  ]);

  return {
    calcs: calcs.map((c) => ({
      id: c.id,
      name: c.name,
      version: c.version,
      status: c.status,
      projectId: c.projectId,
      projectName: c.project?.name ?? null,
      dealStatus: c.project?.dealStatus ?? null,
      wonCalculationId: c.project?.wonCalculationId ?? null,
      projectStatus: c.project?.status ?? null,
      includeWeekends: c.template?.includeWeekends ?? false,
      stages: c.stages,
    })),
    capacities,
  };
}

export async function loadCapacityMatrix(q: CapacityQuery): Promise<CapacityMatrix> {
  const from = q.from ?? new Date();
  const weeks = q.weeks ?? DEFAULT_WEEKS;
  const { calcs, capacities } = await loadCapacityRows(from, weeks, Boolean(q.shifts?.length));
  return buildCapacityMatrix({
    calcs,
    capacities,
    from,
    weeks,
    includeDrafts: q.includeDrafts,
    roles: q.roles,
    shifts: q.shifts,
  });
}

/** Предупреждения для расчёта: недели, где он делает роль перегруженной. */
export async function loadCapacityWarnings(calculationId: string): Promise<CapacityWarning[]> {
  const calc = await prisma.calculation.findUnique({
    where: { id: calculationId },
    select: { stages: { select: { startDate: true, endDate: true } } },
  });
  if (!calc || calc.stages.length === 0) return [];
  const start = new Date(Math.min(...calc.stages.map((s) => s.startDate.getTime())));
  const end = new Date(Math.max(...calc.stages.map((s) => s.endDate.getTime())));
  const weeks = Math.min(
    MAX_WEEKS,
    Math.ceil((end.getTime() - weekStart(start).getTime()) / (7 * 24 * 3600 * 1000)) + 1,
  );
  const matrix = await loadCapacityMatrix({ from: start, weeks, includeDrafts: true });
  return warningsForCalculation(matrix, calculationId);
}
