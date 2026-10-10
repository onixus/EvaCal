import { prisma } from './prisma';
import {
  resolveLifecycle,
  type LifecycleInput,
  type LifecycleReviewContext,
  type LifecycleState,
} from './lifecycle';
import { loadActiveAssignments } from './review/store';

/**
 * Поля, которые нужны конвейеру от проекта, последней версии расчёта и
 * последнего комплекта. Экраны, читающие проекты через Prisma, добавляют
 * эти выборки в свой запрос и передают строки в `lifecycleInputFromRow`.
 */
export const LIFECYCLE_CALC_SELECT = {
  id: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  stageEnteredAt: true,
} as const;

export const LIFECYCLE_PACKAGE_SELECT = {
  id: true,
  calculationId: true,
  status: true,
  reviewStage: true,
  createdAt: true,
  updatedAt: true,
  releasedAt: true,
  approvedAt: true,
  stageEnteredAt: true,
  reviewComment: true,
  releasedBy: true,
  createdBy: true,
} as const;

export interface LifecycleProjectRow {
  id: string;
  status: string;
  dealStatus: string;
  dealClosedAt: Date | null;
  createdAt: Date;
  calculations: {
    id: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    stageEnteredAt?: Date | null;
  }[];
  packages: {
    id: string;
    calculationId: string;
    status: string;
    reviewStage: string;
    createdAt: Date;
    updatedAt: Date;
    releasedAt: Date | null;
    approvedAt: Date | null;
    stageEnteredAt?: Date | null;
    reviewComment?: string | null;
    releasedBy?: string | null;
    createdBy?: string | null;
  }[];
}

type ReviewContextPackage = LifecycleProjectRow['packages'][number];

/**
 * Персональная ответственность для последних комплектов (#103): активное
 * назначение на текущий этап и логин автора выпуска. Два запроса на любой
 * список комплектов.
 */
export async function loadLifecycleReviewContext(
  packages: ReviewContextPackage[],
): Promise<Map<string, LifecycleReviewContext>> {
  const result = new Map<string, LifecycleReviewContext>();
  if (packages.length === 0) return result;
  const authorIds = Array.from(
    new Set(
      packages.flatMap((p) => [p.releasedBy, p.createdBy]).filter((v): v is string => Boolean(v)),
    ),
  );
  const [assignments, users] = await Promise.all([
    loadActiveAssignments(packages.filter((p) => p.status === 'under_review').map((p) => p.id)),
    authorIds.length
      ? prisma.user.findMany({
          where: { id: { in: authorIds } },
          select: { id: true, username: true },
        })
      : Promise.resolve([] as { id: string; username: string }[]),
  ]);
  const names = new Map(users.map((u) => [u.id, u.username]));
  for (const p of packages) {
    const a = assignments.get(`${p.id}:${p.reviewStage}`);
    // releasedBy/createdBy хранят User.id; старые строки — логин или «architect»,
    // их показывать как имя нельзя, тогда ответственным остаётся роль.
    const author =
      (p.releasedBy && names.get(p.releasedBy)) || (p.createdBy && names.get(p.createdBy)) || null;
    result.set(p.id, {
      assignment: a
        ? { assigneeName: a.assigneeName, deputyName: a.deputyName, dueAt: a.dueAt }
        : null,
      authorName: author,
    });
  }
  return result;
}

/** Строка Prisma → вход конвейера. Списки должны быть отсортированы по версии вниз. */
export function lifecycleInputFromRow(
  row: LifecycleProjectRow,
  review?: Map<string, LifecycleReviewContext>,
): LifecycleInput {
  const pkg = row.packages[0];
  return {
    review: pkg && review ? (review.get(pkg.id) ?? null) : null,
    project: {
      id: row.id,
      status: row.status,
      dealStatus: row.dealStatus,
      dealClosedAt: row.dealClosedAt,
      createdAt: row.createdAt,
    },
    calculation: row.calculations[0] ?? null,
    gostPackage: row.packages[0] ?? null,
  };
}

export interface PortfolioProject {
  id: string;
  name: string;
  code: string | null;
  customer: string;
  lifecycle: LifecycleState;
}

/**
 * Сводка по портфелю одинакова для всех сотрудников, а рабочий стол — первый
 * экран после входа, поэтому результат держится в памяти процесса недолго:
 * одна выборка в PORTFOLIO_TTL_MS вместо выборки на каждый заход.
 */
export const PORTFOLIO_TTL_MS = 15_000;
let portfolioCache: { at: number; rows: PortfolioProject[] } | null = null;

/** Сбрасывает кэш (тесты и обработчики, которым нужна свежая сводка сразу). */
export function invalidatePortfolioLifecycle(): void {
  portfolioCache = null;
}

/**
 * Конвейер по всему портфелю для рабочего стола. Архив не показывается: он
 * не двигается по конвейеру намеренно и только зашумлял бы «зависшие».
 */
export async function loadPortfolioLifecycle(now: Date = new Date()): Promise<PortfolioProject[]> {
  if (portfolioCache && now.getTime() - portfolioCache.at < PORTFOLIO_TTL_MS) {
    return portfolioCache.rows;
  }
  const rows = await loadPortfolioLifecycleUncached(now);
  portfolioCache = { at: now.getTime(), rows };
  return rows;
}

async function loadPortfolioLifecycleUncached(now: Date): Promise<PortfolioProject[]> {
  const rows = await prisma.project.findMany({
    where: { status: { not: 'archived' } },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: 500,
    select: {
      id: true,
      name: true,
      code: true,
      customer: true,
      status: true,
      dealStatus: true,
      dealClosedAt: true,
      createdAt: true,
      calculations: { take: 1, orderBy: { version: 'desc' }, select: LIFECYCLE_CALC_SELECT },
      packages: { take: 1, orderBy: { version: 'desc' }, select: LIFECYCLE_PACKAGE_SELECT },
    },
  });
  const review = await loadLifecycleReviewContext(
    rows.flatMap((row) => (row.packages[0] ? [row.packages[0]] : [])),
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    code: row.code,
    customer: row.customer,
    lifecycle: resolveLifecycle(lifecycleInputFromRow(row, review), now),
  }));
}
