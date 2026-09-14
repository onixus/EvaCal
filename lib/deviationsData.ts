/**
 * Выборка строк для отклонений по задачам (Horizon E3). Строка — этап
 * выигранной версии с внесённым фактом часов. Отделена от `lib/deviations.ts`,
 * чтобы срезы тестировались без Prisma.
 */
import { prisma } from '@/lib/prisma';
import { safeJsonParse } from '@/lib/json';
import { daysBetween } from '@/lib/schedule';
import {
  buildDeviationReport,
  normalizeConfig,
  taskCatalog,
  type DeviationReportConfig,
  type DeviationRow,
} from '@/lib/deviations';

export async function loadDeviationRows(): Promise<DeviationRow[]> {
  const projects = await prisma.project.findMany({
    where: { dealStatus: 'won', wonCalculationId: { not: null } },
    select: { wonCalculationId: true, dealClosedAt: true, customer: true },
  });
  const ids = projects.map((p) => p.wonCalculationId as string);
  if (ids.length === 0) return [];
  const meta = new Map(projects.map((p) => [p.wonCalculationId as string, p]));

  const [calcs, approvals, users] = await Promise.all([
    prisma.calculation.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        template: { select: { name: true } },
        stages: {
          where: { isApprovalTask: false, actualHours: { not: null } },
          orderBy: { order: 'asc' },
          select: {
            id: true,
            name: true,
            role: true,
            hours: true,
            actualHours: true,
            startDate: true,
            endDate: true,
            actualStartDate: true,
            actualEndDate: true,
          },
        },
      },
    }),
    prisma.auditEvent.findMany({
      where: { action: 'calculation.approve', entityId: { in: ids } },
      select: { entityId: true, actorId: true },
    }),
    prisma.user.findMany({ select: { id: true, username: true } }),
  ]);
  const approver = new Map(approvals.map((a) => [a.entityId, a.actorId]));
  const nameOf = (raw: string | null | undefined) =>
    raw ? (users.find((u) => u.id === raw)?.username ?? raw) : null;

  return calcs.flatMap((c) => {
    const m = meta.get(c.id);
    return c.stages.map((s) => ({
      calculationId: c.id,
      calculationName: c.name,
      customer: m?.customer ?? '',
      templateName: c.template?.name ?? null,
      architect: nameOf(approver.get(c.id) ?? null),
      closedAt: m?.dealClosedAt ?? null,
      stageId: s.id,
      task: s.name,
      role: s.role,
      plannedHours: s.hours,
      actualHours: s.actualHours as number,
      plannedDays: daysBetween(s.startDate, s.endDate) + 1,
      actualDays:
        s.actualStartDate && s.actualEndDate
          ? daysBetween(s.actualStartDate, s.actualEndDate) + 1
          : null,
    }));
  });
}

/** Каталог задач и списки значений для фильтров конструктора. */
export async function loadDeviationCatalog() {
  const rows = await loadDeviationRows();
  const uniq = (vals: (string | null)[]) =>
    [...new Set(vals.filter((v): v is string => Boolean(v)))].sort();
  return {
    tasks: taskCatalog(rows),
    roles: uniq(rows.map((r) => r.role)),
    templates: uniq(rows.map((r) => r.templateName)),
    architects: uniq(rows.map((r) => r.architect)),
    customers: uniq(rows.map((r) => r.customer)),
    rows: rows.length,
  };
}

export async function runDeviationReport(rawConfig: unknown) {
  const cfg = normalizeConfig(rawConfig);
  const rows = await loadDeviationRows();
  return buildDeviationReport(rows, cfg);
}

export interface SavedReport {
  id: string;
  name: string;
  config: DeviationReportConfig;
  createdBy: string;
  updatedAt: string;
}

export async function listSavedReports(): Promise<SavedReport[]> {
  const rows = await prisma.deviationReport.findMany({ orderBy: { updatedAt: 'desc' } });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    config: normalizeConfig(safeJsonParse(r.config, {})),
    createdBy: r.createdBy,
    updatedAt: r.updatedAt.toISOString(),
  }));
}
