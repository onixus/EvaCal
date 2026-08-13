import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireCalcAccess } from '@/lib/access';
import { actorTypeFromAccess, clientIp, writeAudit } from '@/lib/audit';

// Presale sends the calculation to the architect for review.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const access = await requireCalcAccess(req, params.id, ['write']);
  if (access instanceof NextResponse) return access;

  const existing = await prisma.calculation.findUnique({
    where: { id: params.id },
    select: { status: true },
  });
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // Only an approving role may leave the approved state. Without this check a holder of
  // the seven-day write token could re-submit an approved calculation, which put it back
  // into pending_approval — and PUT turns that into draft, so the approved lock enforced
  // there was bypassed entirely.
  if (existing.status === 'approved') {
    return NextResponse.json(
      { error: 'Расчёт уже утверждён и не может быть отправлен на согласование повторно' },
      { status: 409 },
    );
  }

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
