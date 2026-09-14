import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiRole } from '@/lib/auth';
import { clientIp, writeAudit } from '@/lib/audit';
import { resolveDeal } from '@/lib/actuals';

/**
 * Исход сделки (Horizon E1). Пресейл ведёт сделку, архитектор и админ тоже
 * могут закрыть её — ревьювер нет.
 */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(['presale', 'architect', 'admin']);
  if (auth instanceof NextResponse) return auth;

  const params = await props.params;
  const body = await req.json().catch(() => ({}));

  const project = await prisma.project.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      dealStatus: true,
      actualsClosedAt: true,
      wonCalculationId: true,
      contractAmount: true,
      contractCurrency: true,
      calculations: { select: { id: true, status: true, currency: true } },
    },
  });
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const hasActuals = project.wonCalculationId
    ? (await prisma.stage.count({
        where: {
          calculationId: project.wonCalculationId,
          OR: [{ actualHours: { not: null } }, { actualEndDate: { not: null } }],
        },
      })) > 0
    : false;

  const resolved = resolveDeal({ ...project, hasActuals }, body);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }

  const updated = await prisma.project.update({
    where: { id: project.id },
    data: {
      ...resolved.data,
      dealClosedBy: resolved.data.dealStatus === 'open' ? null : auth.userId,
    },
  });

  await writeAudit({
    actorType: 'user',
    actorId: auth.userId,
    action: `deal.${resolved.data.dealStatus}`,
    entityType: 'project',
    entityId: project.id,
    meta: {
      from: project.dealStatus,
      wonCalculationId: resolved.data.wonCalculationId,
      lossReason: resolved.data.lossReason,
      contractAmount: resolved.data.contractAmount,
    },
    ip: clientIp(req),
  });

  return NextResponse.json(updated);
}
