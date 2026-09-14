/**
 * Выборка данных для рейтинга из БД. Отделена от `lib/leaderboard.ts`, чтобы
 * агрегацию можно было тестировать без Prisma.
 */
import { prisma } from '@/lib/prisma';
import {
  buildLeaderboard,
  periodSince,
  type Leaderboard,
  type LeaderboardPeriod,
} from '@/lib/leaderboard';

export async function loadLeaderboard(period: LeaderboardPeriod): Promise<Leaderboard> {
  const since = periodSince(period);
  const sinceFilter = since ? { gte: since } : undefined;

  const [users, calculations, packages, approvals] = await Promise.all([
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
      select: { actorId: true },
    }),
  ]);

  return buildLeaderboard({ period, users, calculations, packages, approvals });
}
