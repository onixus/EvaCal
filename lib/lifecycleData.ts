import { prisma } from './prisma';
import { resolveLifecycle, type LifecycleInput, type LifecycleState } from './lifecycle';

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
  }[];
}

/** Строка Prisma → вход конвейера. Списки должны быть отсортированы по версии вниз. */
export function lifecycleInputFromRow(row: LifecycleProjectRow): LifecycleInput {
  return {
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
 * Конвейер по всему портфелю для рабочего стола. Архив не показывается: он
 * не двигается по конвейеру намеренно и только зашумлял бы «зависшие».
 */
export async function loadPortfolioLifecycle(now: Date = new Date()): Promise<PortfolioProject[]> {
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
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    code: row.code,
    customer: row.customer,
    lifecycle: resolveLifecycle(lifecycleInputFromRow(row), now),
  }));
}
