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

/** null/'' — очистить; иначе неотрицательное конечное число; undefined — некорректно. */
function hoursOrNull(v: unknown): number | null | undefined {
  if (v === null || v === '') return null;
  if (typeof v === 'boolean') return undefined;
  const h = Number(v);
  return Number.isFinite(h) && h >= 0 ? h : undefined;
}

/**
 * Факт часов РП и подтверждённый остаток часов РП (#103 4.5). Отдельно от
 * PATCH расчёта: тот запрещён для утверждённых версий.
 */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(['architect', 'admin']);
  if (auth instanceof NextResponse) return auth;
  const params = await props.params;
  const gate = await actualsWriteGate(params.id, auth.role);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (body.actualPmHours !== undefined) {
    const actualPmHours = hoursOrNull(body.actualPmHours);
    if (actualPmHours === undefined) {
      return NextResponse.json({ error: 'Факт часов РП: неотрицательное число' }, { status: 400 });
    }
    data.actualPmHours = actualPmHours;
  }
  if (body.remainingPmHoursEstimate !== undefined) {
    const remaining = hoursOrNull(body.remainingPmHoursEstimate);
    if (remaining === undefined) {
      return NextResponse.json(
        { error: 'Оставшиеся часы РП: неотрицательное число или null' },
        { status: 400 },
      );
    }
    data.remainingPmHoursEstimate = remaining;
    data.remainingPmEstimatedBy = remaining === null ? null : auth.username;
    data.remainingPmEstimatedAt = remaining === null ? null : new Date();
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Факт часов РП: неотрицательное число' }, { status: 400 });
  }
  await prisma.calculation.update({ where: { id: params.id }, data });
  if (data.actualPmHours !== undefined) {
    await writeAudit({
      actorType: 'user',
      actorId: auth.userId,
      action: 'calculation.actualPm',
      entityType: 'calculation',
      entityId: params.id,
      meta: { actualPmHours: data.actualPmHours },
      ip: clientIp(req),
    });
  }
  if (data.remainingPmHoursEstimate !== undefined) {
    await writeAudit({
      actorType: 'user',
      actorId: auth.userId,
      action: 'calculation.remainingPm',
      entityType: 'calculation',
      entityId: params.id,
      meta: { remainingPmHoursEstimate: data.remainingPmHoursEstimate },
      ip: clientIp(req),
    });
  }
  return NextResponse.json({ ok: true, ...data });
}
