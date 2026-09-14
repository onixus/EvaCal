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
    // Исходы сделок (E1): решённые за период. Выигрыш — автору версии, по
    // которой подписан договор; проигрыш — автору последней версии.
    prisma.project.findMany({
      where: {
        dealStatus: { in: ['won', 'lost'] },
        ...(sinceFilter ? { dealClosedAt: sinceFilter } : {}),
      },
      select: {
        dealStatus: true,
        wonCalculationId: true,
        calculations: {
          orderBy: { version: 'desc' },
          select: { id: true, createdBy: true },
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
  // Кто согласовал расчёт. Отдельный запрос без фильтра по дате: согласование
  // и закрытие сделки разнесены во времени, и журнал за период его не содержит.
  const approverEvents = wonIds.length
    ? await prisma.auditEvent.findMany({
        where: { action: 'calculation.approve', entityId: { in: wonIds } },
        select: { entityId: true, actorId: true },
      })
    : [];
  const approverOf = new Map<string, string | null>();
  for (const a of approverEvents) if (a.entityId) approverOf.set(a.entityId, a.actorId);
  const accuracy: AccuracyRow[] = wonCalcs.flatMap((c) => {
    const acc = calculationAccuracy(c.stages);
    return acc.deviation === null
      ? []
      : [{ approvedBy: approverOf.get(c.id) ?? null, deviation: acc.deviation }];
  });
  // Проект без расчётов не имеет автора-пресейла: такой исход в рейтинг не идёт.
  const deals = closedDeals.flatMap((p) => {
    const won = p.calculations.find((c) => c.id === p.wonCalculationId);
    const author = (p.dealStatus === 'won' ? won : null) ?? p.calculations[0];
    return author ? [{ dealStatus: p.dealStatus, createdBy: author.createdBy }] : [];
  });

  return buildLeaderboard({ period, users, calculations, packages, approvals, deals, accuracy });
}
