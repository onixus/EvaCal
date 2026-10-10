import { NextRequest, NextResponse } from 'next/server';
import { requireCalcAccess } from '@/lib/access';
import { actorTypeFromAccess, clientIp, writeAudit } from '@/lib/audit';
import { applySizingImpact } from '@/lib/sizing/service';
import { sizingError } from '@/lib/sizing/http';

export const dynamic = 'force-dynamic';
type Params = { params: Promise<{ id: string }> };

/** Применить выбранные изменения сайзинга: новая черновая редакция спецификации. */
export async function POST(req: NextRequest, props: Params) {
  try {
    const { id } = await props.params;
    const access = await requireCalcAccess(req, id, ['write']);
    if (access instanceof NextResponse) return access;
    const body = await req.json();
    const saved = await applySizingImpact(id, body, access.actorId);
    await writeAudit({
      actorType: actorTypeFromAccess(access.kind),
      actorId: access.actorId,
      action: 'specification.sizing.apply',
      entityType: 'calculation',
      entityId: id,
      meta: { version: saved.snapshot.version, runId: body?.runId },
      ip: clientIp(req),
    });
    return NextResponse.json(saved, { status: 201 });
  } catch (error) {
    return sizingError(error, 'Не удалось применить сайзинг');
  }
}
