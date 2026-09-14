/**
 * Выборка данных факта и сделок из БД (Horizon E1). Отделена от
 * `lib/actuals.ts`, чтобы метрики тестировались без Prisma.
 */
import { prisma } from '@/lib/prisma';
import { periodSince, type LeaderboardPeriod } from '@/lib/leaderboard';
import { projectSchedule } from '@/lib/schedule';
import {
  accuracyBy,
  accuracyPoints,
  actualMargin,
  calculationAccuracy,
  discountOutcomes,
  lossReasons,
  monthlyWins,
  roleBias,
  winRate,
  winRateBy,
  type AccuracyCalcRow,
  type DealRow,
} from '@/lib/actuals';

export interface WonContext {
  calculationId: string;
  project: {
    id: string;
    dealStatus: string;
    wonCalculationId: string | null;
    actualsClosedAt: Date | null;
  };
  isWonVersion: boolean;
}

/** Проект расчёта и признак «это выигранная версия». null — расчёта нет. */
export async function wonContext(calculationId: string): Promise<WonContext | null> {
  const calc = await prisma.calculation.findUnique({
    where: { id: calculationId },
    select: {
      id: true,
      project: {
        select: { id: true, dealStatus: true, wonCalculationId: true, actualsClosedAt: true },
      },
    },
  });
  if (!calc || !calc.project) return null;
  return {
    calculationId,
    project: calc.project,
    isWonVersion: calc.project.dealStatus === 'won' && calc.project.wonCalculationId === calc.id,
  };
}

/**
 * Можно ли писать факт по расчёту: только выигранная версия; после закрытия
 * факта — только админ (с аудитом, как и все записи факта).
 */
export async function actualsWriteGate(
  calculationId: string,
  role: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const ctx = await wonContext(calculationId);
  if (!ctx) return { ok: false, error: 'Расчёт не привязан к проекту', status: 404 };
  if (!ctx.isWonVersion) {
    return {
      ok: false,
      error: 'Факт ведётся только по версии, по которой выиграна сделка',
      status: 409,
    };
  }
  if (ctx.project.actualsClosedAt && role !== 'admin') {
    return {
      ok: false,
      error: 'Факт по проекту закрыт; правка — только через администратора',
      status: 403,
    };
  }
  return { ok: true };
}

export async function loadActualsSummary(calculationId: string) {
  const calc = await prisma.calculation.findUnique({
    where: { id: calculationId },
    select: {
      id: true,
      actualPmHours: true,
      pmHours: true,
      roleRates: true,
      overheadPercent: true,
      stages: {
        orderBy: { order: 'asc' },
        select: {
          id: true,
          name: true,
          role: true,
          hours: true,
          isApprovalTask: true,
          actualHours: true,
          startDate: true,
          endDate: true,
          actualStartDate: true,
          actualEndDate: true,
          actualNote: true,
        },
      },
      project: {
        select: {
          id: true,
          dealStatus: true,
          wonCalculationId: true,
          actualsClosedAt: true,
          contractAmount: true,
          contractCurrency: true,
        },
      },
    },
  });
  if (!calc) return null;
  const isWonVersion =
    calc.project?.dealStatus === 'won' && calc.project.wonCalculationId === calc.id;
  const accuracy = calculationAccuracy(calc.stages);
  const margin = actualMargin({
    stages: calc.stages,
    actualPmHours: calc.actualPmHours,
    roleRates: calc.roleRates,
    overheadPercent: calc.overheadPercent,
    contractAmount: calc.project?.contractAmount ?? null,
  });
  return {
    calculationId: calc.id,
    isWonVersion,
    actualsClosedAt: calc.project?.actualsClosedAt?.toISOString() ?? null,
    contractCurrency: calc.project?.contractCurrency ?? null,
    pmHours: calc.pmHours,
    actualPmHours: calc.actualPmHours,
    stages: calc.stages.map((s) => ({
      ...s,
      startDate: s.startDate.toISOString(),
      endDate: s.endDate.toISOString(),
      actualStartDate: s.actualStartDate?.toISOString() ?? null,
      actualEndDate: s.actualEndDate?.toISOString() ?? null,
    })),
    accuracy,
    margin,
    schedule: isWonVersion ? projectSchedule(calc.stages) : null,
  };
}

async function loadDealRows(period: LeaderboardPeriod): Promise<DealRow[]> {
  const since = periodSince(period);
  const projects = await prisma.project.findMany({
    where: since
      ? {
          OR: [{ dealClosedAt: { gte: since } }, { dealStatus: 'open', createdAt: { gte: since } }],
        }
      : undefined,
    select: {
      id: true,
      dealStatus: true,
      dealClosedAt: true,
      lossReason: true,
      createdBy: true,
      wonCalculationId: true,
      calculations: {
        orderBy: { version: 'desc' },
        select: {
          id: true,
          status: true,
          discountPercent: true,
          createdBy: true,
          template: { select: { name: true } },
        },
      },
    },
  });
  return projects.map((p) => {
    const won = p.calculations.find((c) => c.id === p.wonCalculationId);
    const ref = won ?? p.calculations.find((c) => c.status === 'approved') ?? p.calculations[0];
    return {
      id: p.id,
      dealStatus: p.dealStatus,
      dealClosedAt: p.dealClosedAt,
      lossReason: p.lossReason,
      createdBy: ref?.createdBy ?? p.createdBy,
      discountPercent: ref ? ref.discountPercent : null,
      templateName: ref?.template?.name ?? null,
    };
  });
}

export async function loadDealAnalytics(period: LeaderboardPeriod) {
  const rows = await loadDealRows(period);
  return {
    period,
    generatedAt: new Date().toISOString(),
    total: rows.length,
    winRate: winRate(rows),
    monthly: monthlyWins(rows),
    lossReasons: lossReasons(rows),
    byDiscount: discountOutcomes(rows),
    byTemplate: winRateBy(rows, (r) => r.templateName),
    byPresale: winRateBy(rows, (r) => r.createdBy),
  };
}

export async function loadAccuracyRows(
  period: LeaderboardPeriod,
  templateId?: string,
): Promise<AccuracyCalcRow[]> {
  const since = periodSince(period);
  const projects = await prisma.project.findMany({
    where: {
      dealStatus: 'won',
      wonCalculationId: { not: null },
      ...(since ? { dealClosedAt: { gte: since } } : {}),
    },
    select: { wonCalculationId: true, dealClosedAt: true },
  });
  const ids = projects.map((p) => p.wonCalculationId as string);
  if (ids.length === 0) return [];
  const closedAt = new Map(projects.map((p) => [p.wonCalculationId as string, p.dealClosedAt]));

  const [calcs, approvals] = await Promise.all([
    prisma.calculation.findMany({
      where: { id: { in: ids }, ...(templateId ? { templateId } : {}) },
      select: {
        id: true,
        name: true,
        createdBy: true,
        template: { select: { name: true } },
        stages: {
          select: { name: true, role: true, hours: true, isApprovalTask: true, actualHours: true },
        },
      },
    }),
    prisma.auditEvent.findMany({
      where: { action: 'calculation.approve', entityId: { in: ids } },
      select: { entityId: true, actorId: true },
    }),
  ]);
  const approver = new Map(approvals.map((a) => [a.entityId, a.actorId]));
  const users = await prisma.user.findMany({ select: { id: true, username: true } });
  const nameOf = (raw: string | null | undefined) =>
    raw ? (users.find((u) => u.id === raw)?.username ?? raw) : null;

  return calcs.map((c) => ({
    id: c.id,
    name: c.name,
    templateName: c.template?.name ?? null,
    architect: nameOf(approver.get(c.id) ?? null),
    closedAt: closedAt.get(c.id) ?? null,
    stages: c.stages,
  }));
}

export async function loadAccuracyAnalytics(period: LeaderboardPeriod, templateId?: string) {
  const rows = await loadAccuracyRows(period, templateId);
  const points = accuracyPoints(rows);
  return {
    period,
    generatedAt: new Date().toISOString(),
    projects: rows.length,
    withActuals: points.length,
    points,
    byRole: roleBias(rows),
    byTemplate: accuracyBy(points, (p) => p.templateName),
    byArchitect: accuracyBy(points, (p) => p.architect),
  };
}
