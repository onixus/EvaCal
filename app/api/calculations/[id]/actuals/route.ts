import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiRole } from '@/lib/auth';
import { clientIp, writeAudit } from '@/lib/audit';
import { actualsWriteGate, loadActualsSummary } from '@/lib/actualsData';

/** Сводка факта по расчёту: точность, маржа, состояние сделки. */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(['presale', 'architect', 'reviewer', 'admin']);
  if (auth instanceof NextResponse) return auth;
  const params = await props.params;
  const summary = await loadActualsSummary(params.id);
  if (!summary) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(summary);
}

/** Факт часов РП. Отдельно от PATCH расчёта: тот запрещён для утверждённых версий. */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(['architect', 'admin']);
  if (auth instanceof NextResponse) return auth;
  const params = await props.params;
  const gate = await actualsWriteGate(params.id, auth.role);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const body = await req.json().catch(() => ({}));
  let actualPmHours: number | null;
  if (body.actualPmHours === null || body.actualPmHours === '') actualPmHours = null;
  else {
    actualPmHours = Number(body.actualPmHours);
    if (!Number.isFinite(actualPmHours) || actualPmHours < 0) {
      return NextResponse.json({ error: 'Факт часов РП: неотрицательное число' }, { status: 400 });
    }
  }
  await prisma.calculation.update({ where: { id: params.id }, data: { actualPmHours } });
  await writeAudit({
    actorType: 'user',
    actorId: auth.userId,
    action: 'calculation.actualPm',
    entityType: 'calculation',
    entityId: params.id,
    meta: { actualPmHours },
    ip: clientIp(req),
  });
  return NextResponse.json({ ok: true, actualPmHours });
}
