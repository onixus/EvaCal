import { prisma } from '@/lib/prisma';
import { pageArgs, parsePage } from '@/lib/pagination';
import { grandTotalHours } from '@/lib/totals';
import { backfillProjects } from '@/lib/project';
import ProjectsListClient, { ProjectListItem } from './ProjectsListClient';

export const dynamic = 'force-dynamic';

export default async function ProjectsPage(props: {
  searchParams: Promise<{ page?: string; search?: string; status?: string }>;
}) {
  // Ensure any legacy orphaned calculations are linked to projects
  await backfillProjects().catch(() => {});

  const searchParams = await props.searchParams;
  const page = parsePage(searchParams.page);
  const search = searchParams.search?.trim();
  const status = searchParams.status?.trim();

  const where: Record<string, unknown> = {};

  if (search) {
    where.OR = [
      { name: { contains: search } },
      { customer: { contains: search } },
      { code: { contains: search } },
    ];
  }

  if (status && status !== 'all') {
    where.status = status;
  }

  const [total, activeCount, completedCount, totalPackages, rawProjects] = await Promise.all([
    prisma.project.count({ where }),
    prisma.project.count({ where: { status: 'active' } }),
    prisma.project.count({ where: { status: 'completed' } }),
    prisma.gostPackage.count(),
    prisma.project.findMany({
      where,
      ...pageArgs(page),
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      include: {
        _count: {
          select: {
            calculations: true,
            packages: true,
          },
        },
        calculations: {
          take: 1,
          orderBy: { version: 'desc' },
          include: {
            stages: { select: { hours: true, isApprovalTask: true } },
            risks: { select: { hours: true } },
          },
        },
        packages: {
          take: 1,
          orderBy: { version: 'desc' },
          select: {
            id: true,
            name: true,
            version: true,
            status: true,
            updatedAt: true,
          },
        },
      },
    }),
  ]);

  const projects: ProjectListItem[] = rawProjects.map((p) => {
    const latestCalc = p.calculations[0] ?? null;
    const latestPkg = p.packages[0] ?? null;

    return {
      id: p.id,
      name: p.name,
      code: p.code,
      customer: p.customer,
      description: p.description,
      status: p.status,
      createdBy: p.createdBy,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      calculationCount: p._count.calculations,
      packageCount: p._count.packages,
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

  return (
    <ProjectsListClient
      projects={projects}
      total={total}
      activeCount={activeCount}
      completedCount={completedCount}
      totalPackages={totalPackages}
      currentPage={page}
      searchQuery={search || ''}
      statusFilter={status || 'all'}
    />
  );
}
