import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiRole } from '@/lib/auth';
import { clientIp, writeAudit } from '@/lib/audit';
import { wonContext } from '@/lib/actualsData';

/**
 * Закрыть факт (`{ closed: true }`) или переоткрыть (`{ closed: false }`).
 * Закрывает архитектор; переоткрыть после закрытия может только админ —
 * иначе «закрыто» ничего не значило бы.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(['architect', 'admin']);
  if (auth instanceof NextResponse) return auth;
  const params = await props.params;
  const body = await req.json().catch(() => ({}));
  const closed = body.closed !== false;

  const ctx = await wonContext(params.id);
  if (!ctx) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (!ctx.isWonVersion) {
    return NextResponse.json(
      { error: 'Факт ведётся только по выигранной версии' },
      { status: 409 },
    );
  }
  if (!closed && ctx.project.actualsClosedAt && auth.role !== 'admin') {
    return NextResponse.json(
      { error: 'Переоткрыть факт может только администратор' },
      { status: 403 },
    );
  }

  await prisma.project.update({
    where: { id: ctx.project.id },
    data: { actualsClosedAt: closed ? new Date() : null },
  });
  await writeAudit({
    actorType: 'user',
    actorId: auth.userId,
    action: closed ? 'actuals.close' : 'actuals.reopen',
    entityType: 'project',
    entityId: ctx.project.id,
    meta: { calculationId: params.id },
    ip: clientIp(req),
  });
  return NextResponse.json({ ok: true, closed });
}
