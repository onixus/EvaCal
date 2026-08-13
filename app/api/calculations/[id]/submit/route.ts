import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireCalcAccess } from '@/lib/access';
import { actorTypeFromAccess, clientIp, writeAudit } from '@/lib/audit';

// Presale sends the calculation to the architect for review.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const access = await requireCalcAccess(req, params.id, ['write']);
  if (access instanceof NextResponse) return access;

  const calculation = await prisma.calculation.update({
    where: { id: params.id },
    data: { status: 'pending_approval' },
  });

  await writeAudit({
    actorType: actorTypeFromAccess(access.kind),
    actorId: access.actorId,
    action: 'calculation.submit',
    entityType: 'calculation',
    entityId: params.id,
    ip: clientIp(req),
  });

  return NextResponse.json(calculation);
}
