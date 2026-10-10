import { NextRequest, NextResponse } from 'next/server';
import { requireCalcAccess } from '@/lib/access';
import { actorTypeFromAccess, clientIp, writeAudit } from '@/lib/audit';
import { linkSizing } from '@/lib/sizing/service';
import { sizingError } from '@/lib/sizing/http';

export const dynamic = 'force-dynamic';
type Params = { params: Promise<{ id: string }> };

/**
 * Связать строку спецификации с метрикой прогона ({ version, itemId, runId, metric,
 * scenario?, unitCapacity? }) или снять связь (runId: null). Новая черновая редакция.
 */
export async function POST(req: NextRequest, props: Params) {
  try {
    const { id } = await props.params;
    const access = await requireCalcAccess(req, id, ['write']);
    if (access instanceof NextResponse) return access;
    const body = await req.json();
    const saved = await linkSizing(id, body, access.actorId);
    await writeAudit({
      actorType: actorTypeFromAccess(access.kind),
      actorId: access.actorId,
      action: body?.runId === null ? 'specification.sizing.unlink' : 'specification.sizing.link',
      entityType: 'calculation',
      entityId: id,
      meta: { version: saved.snapshot.version, itemId: body?.itemId, runId: body?.runId },
      ip: clientIp(req),
    });
    return NextResponse.json(saved, { status: 201 });
  } catch (error) {
    return sizingError(error, 'Не удалось связать позицию с сайзингом');
  }
}
