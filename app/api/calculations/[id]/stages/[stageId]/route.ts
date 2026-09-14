import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiRole } from '@/lib/auth';
import { clientIp, writeAudit } from '@/lib/audit';
import { actualsWriteGate } from '@/lib/actualsData';

const ALLOWED_STATUSES = ['planned', 'in_progress', 'done', 'approved', 'rejected'];

function parseDate(v: unknown): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Статус этапа (как и раньше) и факт по этапу (Horizon E1). Даты/часы плана
 * здесь не правятся — они принадлежат перестройке этапов.
 */
export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ id: string; stageId: string }> },
) {
  const params = await props.params;
  const auth = await requireApiRole(['architect', 'admin']);
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};

  if (body.status !== undefined) {
    if (!ALLOWED_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: 'invalid status' }, { status: 400 });
    }
    data.status = body.status;
  }

  const touchesActuals = ['actualHours', 'actualStartDate', 'actualEndDate', 'actualNote'].some(
    (k) => body[k] !== undefined,
  );
  if (touchesActuals) {
    const gate = await actualsWriteGate(params.id, auth.role);
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

    if (body.actualHours !== undefined) {
      if (body.actualHours === null || body.actualHours === '') {
        data.actualHours = null;
      } else {
        const h = Number(body.actualHours);
        if (!Number.isFinite(h) || h < 0) {
          return NextResponse.json({ error: 'Факт часов: неотрицательное число' }, { status: 400 });
        }
        data.actualHours = h;
      }
    }
    for (const key of ['actualStartDate', 'actualEndDate'] as const) {
      const d = parseDate(body[key]);
      if (body[key] !== undefined && d === undefined) {
        return NextResponse.json({ error: `Некорректная дата в ${key}` }, { status: 400 });
      }
      if (d !== undefined) data[key] = d;
    }
    if (body.actualNote !== undefined)
      data.actualNote = String(body.actualNote ?? '').trim() || null;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Нечего обновлять' }, { status: 400 });
  }

  const existing = await prisma.stage.findUnique({ where: { id: params.stageId } });
  if (!existing || existing.calculationId !== params.id) {
    return NextResponse.json({ error: 'Stage not found' }, { status: 404 });
  }

  const stage = await prisma.stage.update({ where: { id: params.stageId }, data });

  if (touchesActuals) {
    await writeAudit({
      actorType: 'user',
      actorId: auth.userId,
      action: 'stage.actual',
      entityType: 'stage',
      entityId: stage.id,
      meta: { calculationId: params.id, actualHours: stage.actualHours },
      ip: clientIp(req),
    });
  }
  return NextResponse.json(stage);
}
