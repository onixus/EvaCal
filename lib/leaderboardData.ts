/**
 * Выборка данных для рейтинга из БД. Отделена от `lib/leaderboard.ts`, чтобы
 * агрегацию можно было тестировать без Prisma.
 */
import { prisma } from '@/lib/prisma';
import {
  buildLeaderboard,
  periodSince,
  type AccuracyRow,
  type Leaderboard,
  type LeaderboardPeriod,
} from '@/lib/leaderboard';
import { calculationAccuracy } from '@/lib/actuals';

export async function loadLeaderboard(period: LeaderboardPeriod): Promise<Leaderboard> {
  const since = periodSince(period);
  const sinceFilter = since ? { gte: since } : undefined;

  const [users, calculations, packages, approvals, wonProjects, closedDeals] = await Promise.all([
    prisma.user.findMany({ select: { id: true, username: true, role: true } }),
    prisma.calculation.findMany({
      where: sinceFilter ? { createdAt: sinceFilter } : undefined,
      select: {
        createdBy: true,
        status: true,
        version: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.gostPackage.findMany({
      where: sinceFilter ? { createdAt: sinceFilter } : undefined,
      select: {
        createdBy: true,
        releasedBy: true,
        approvedBy: true,
        status: true,
        releasedAt: true,
        approvedAt: true,
      },
    }),
    prisma.auditEvent.findMany({
      where: { action: 'calculation.approve', ...(sinceFilter ? { at: sinceFilter } : {}) },
      select: { actorId: true, entityId: true },
    }),
    // Точность (E1): выигранные проекты с фактом по этапам выигранной версии.
    prisma.project.findMany({
      where: {
        dealStatus: 'won',
        wonCalculationId: { not: null },
        ...(sinceFilter ? { dealClosedAt: sinceFilter } : {}),
      },
      select: { wonCalculationId: true },
    }),
    // Исходы сделок (E1): решённые за период, автор — создатель последней утверждённой версии.
    prisma.project.findMany({
      where: {
        dealStatus: { in: ['won', 'lost'] },
        ...(sinceFilter ? { dealClosedAt: sinceFilter } : {}),
      },
      select: {
        dealStatus: true,
        createdBy: true,
        calculations: {
          where: { status: 'approved' },
          orderBy: { version: 'desc' },
          take: 1,
          select: { createdBy: true },
        },
      },
    }),
  ]);

  const wonIds = wonProjects.map((p) => p.wonCalculationId as string);
  const wonCalcs = wonIds.length
    ? await prisma.calculation.findMany({
        where: { id: { in: wonIds } },
        select: {
          id: true,
          stages: {
            select: {
              name: true,
              role: true,
              hours: true,
              isApprovalTask: true,
              actualHours: true,
            },
          },
        },
      })
    : [];
  // Кто согласовал расчёт — из того же журнала, что и счётчик согласований.
  const approverOf = new Map<string, string | null>();
  for (const a of approvals) if (a.entityId) approverOf.set(a.entityId, a.actorId);
  const accuracy: AccuracyRow[] = wonCalcs.flatMap((c) => {
    const acc = calculationAccuracy(c.stages);
    return acc.deviation === null
      ? []
      : [{ approvedBy: approverOf.get(c.id) ?? null, deviation: acc.deviation }];
  });
  const deals = closedDeals.map((p) => ({
    dealStatus: p.dealStatus,
    createdBy: p.calculations[0]?.createdBy ?? p.createdBy,
  }));

  return buildLeaderboard({ period, users, calculations, packages, approvals, deals, accuracy });
}
