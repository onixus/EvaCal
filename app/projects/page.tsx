import { prisma } from '@/lib/prisma';
import { PAGE_SIZE, pageArgs, parsePage } from '@/lib/pagination';
import { containsInsensitive } from '@/lib/textSearch';
import { grandTotalHours } from '@/lib/totals';
import { backfillProjects } from '@/lib/project';
import { getSession } from '@/lib/auth';
import { LIFECYCLE_INDEX, resolveLifecycle, type LifecycleStageId } from '@/lib/lifecycle';
import {
  LIFECYCLE_CALC_SELECT,
  LIFECYCLE_PACKAGE_SELECT,
  lifecycleInputFromRow,
} from '@/lib/lifecycleData';
import ProjectsListClient, { type ProjectListItem } from './ProjectsListClient';

export const dynamic = 'force-dynamic';

const STATUSES = ['active', 'on_hold', 'completed', 'archived'];

function isStage(value: string | undefined): value is LifecycleStageId {
  return !!value && value in LIFECYCLE_INDEX;
}

export default async function ProjectsPage(props: {
  searchParams: Promise<{ page?: string; search?: string; status?: string; stage?: string }>;
}) {
  // Ensure any legacy orphaned calculations are linked to projects
  await backfillProjects().catch(() => {});

  const [searchParams, session] = await Promise.all([props.searchParams, getSession()]);
  const page = parsePage(searchParams.page);
  const search = searchParams.search?.trim() || '';
  const status = STATUSES.includes(searchParams.status ?? '') ? searchParams.status! : 'all';
  const stage = isStage(searchParams.stage) ? searchParams.stage : null;

  const where: Record<string, unknown> = {};
  if (search) {
    where.OR = [
      { name: containsInsensitive(search) },
      { customer: containsInsensitive(search) },
      { code: containsInsensitive(search) },
    ];
  }
  if (status !== 'all') where.status = status;

  const select = {
    id: true,
    name: true,
    code: true,
    customer: true,
    description: true,
    status: true,
    dealStatus: true,
    dealClosedAt: true,
    createdBy: true,
    createdAt: true,
    updatedAt: true,
    _count: { select: { calculations: true, packages: true } },
    calculations: {
      take: 1,
      orderBy: { version: 'desc' as const },
      select: {
        ...LIFECYCLE_CALC_SELECT,
        version: true,
        name: true,
        pmHours: true,
        stages: { select: { hours: true, isApprovalTask: true } },
        risks: { select: { hours: true } },
      },
    },
    packages: {
      take: 1,
      orderBy: { version: 'desc' as const },
      select: { ...LIFECYCLE_PACKAGE_SELECT, name: true, version: true },
    },
  };

  /*
    Этап конвейера — вычисляемое поле, а не колонка, поэтому фильтр по нему
    считается в памяти: проектов сотни, и это дешевле, чем дублировать
    статус в базе и следить за его согласованностью.
  */
  const [statusCounts, rawProjects, totalMatching] = await Promise.all([
    prisma.project.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.project.findMany({
      where,
      ...(stage ? { skip: 0, take: 500 } : pageArgs(page)),
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select,
    }),
    prisma.project.count({ where }),
  ]);

  const now = new Date();
  let items: ProjectListItem[] = rawProjects.map((p) => {
    const latestCalc = p.calculations[0] ?? null;
    const latestPkg = p.packages[0] ?? null;
    return {
      id: p.id,
      name: p.name,
      code: p.code,
      customer: p.customer,
      description: p.description,
      status: p.status,
      dealStatus: p.dealStatus,
      createdBy: p.createdBy,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      calculationCount: p._count.calculations,
      packageCount: p._count.packages,
      lifecycle: resolveLifecycle(lifecycleInputFromRow(p), now),
      latestCalculation: latestCalc
        ? {
            id: latestCalc.id,
            version: latestCalc.version,
            name: latestCalc.name,
            status: latestCalc.status,
            totalHours: grandTotalHours(latestCalc.stages, latestCalc.pmHours, latestCalc.risks),
            updatedAt: latestCalc.updatedAt.toISOString(),
          }
        : null,
      latestPackage: latestPkg
        ? {
            id: latestPkg.id,
            name: latestPkg.name,
            version: latestPkg.version,
            status: latestPkg.status,
            updatedAt: latestPkg.updatedAt.toISOString(),
          }
        : null,
    };
  });

  let total = totalMatching;
  if (stage) {
    items = items.filter((p) => p.lifecycle.stage === stage);
    total = items.length;
    items = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  }

  const countOf = (s: string) => statusCounts.find((c) => c.status === s)?._count._all ?? 0;

  return (
    <ProjectsListClient
      projects={items}
      total={total}
      currentPage={page}
      searchQuery={search}
      statusFilter={status}
      stageFilter={stage}
      statusCounts={{
        all: statusCounts.reduce((s, c) => s + c._count._all, 0),
        active: countOf('active'),
        on_hold: countOf('on_hold'),
        completed: countOf('completed'),
        archived: countOf('archived'),
      }}
      canCreate={['presale', 'architect', 'admin'].includes(session?.role ?? '')}
    />
  );
}
