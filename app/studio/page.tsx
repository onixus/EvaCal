import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/auth';
import type { ReviewStage } from '@/lib/gost34/review/types';
import StudioPickerClient, { type StudioCalculationItem } from './StudioPickerClient';

export const dynamic = 'force-dynamic';

/**
 * Студия открывается для конкретного расчёта, поэтому пункт навигации ведёт
 * на выбор расчёта, с наглядной подсветкой черновиков и отклонённых на ревью комплектов.
 */
export default async function StudioPickerPage() {
  await requireRole(['architect', 'admin'], '/studio');

  const rows = await prisma.calculation.findMany({
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: 50,
    select: {
      id: true,
      name: true,
      customer: true,
      version: true,
      updatedAt: true,
      standardProfileId: true,
      project: { select: { customer: true } },
      gostPackages: {
        orderBy: [{ version: 'desc' }, { updatedAt: 'desc' }],
        take: 5,
        select: {
          id: true,
          name: true,
          version: true,
          status: true,
          reviewStage: true,
          reviewComment: true,
          reviewComments: true,
          reviewChecklist: true,
          updatedAt: true,
          releasedAt: true,
        },
      },
    },
  });

  const calculations: StudioCalculationItem[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    customer: r.project?.customer || r.customer || 'Заказчик',
    version: r.version,
    updatedAt: r.updatedAt.toISOString(),
    standardProfileId: r.standardProfileId,
    packages: r.gostPackages.map((p) => ({
      id: p.id,
      name: p.name,
      version: p.version,
      status: p.status,
      reviewStage: (p.reviewStage === 'gap' ? 'gap' : p.reviewStage === 'done' ? 'done' : 'tw') as ReviewStage,
      reviewComment: p.reviewComment,
      reviewComments: p.reviewComments,
      reviewChecklist: p.reviewChecklist,
      updatedAt: p.updatedAt.toISOString(),
      releasedAt: p.releasedAt ? p.releasedAt.toISOString() : null,
    })),
  }));

  return <StudioPickerClient calculations={calculations} />;
}

