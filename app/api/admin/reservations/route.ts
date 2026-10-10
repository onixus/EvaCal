import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiRole } from '@/lib/auth';
import { clientIp, writeAudit } from '@/lib/audit';
import { parseReservationInput } from '@/lib/calendarAdmin';

export const dynamic = 'force-dynamic';

/**
 * Резервы ёмкости ролей (#103 WP-5d): отпуска, пресейл, внутренние работы.
 * Ресурсный план вычитает их из ёмкости роли. Читают планирующие, пишет админ.
 */
export async function GET() {
  const auth = await requireApiRole(['architect', 'gap', 'techwriter', 'reviewer', 'admin']);
  if (auth instanceof NextResponse) return auth;
  const rows = await prisma.roleReservation.findMany({
    orderBy: [{ from: 'desc' }, { role: 'asc' }],
  });
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const auth = await requireApiRole(['admin']);
  if (auth instanceof NextResponse) return auth;
  const parsed = parseReservationInput(await req.json().catch(() => ({})));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const row = await prisma.roleReservation.create({
    data: { ...parsed.value, createdBy: auth.userId },
  });
  await writeAudit({
    actorType: 'user',
    actorId: auth.userId,
    action: 'reservation.create',
    entityType: 'roleReservation',
    entityId: row.id,
    meta: {
      role: row.role,
      from: row.from.toISOString().slice(0, 10),
      to: row.to.toISOString().slice(0, 10),
      hoursPerWeek: row.hoursPerWeek,
    },
    ip: clientIp(req),
  });
  return NextResponse.json(row, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireApiRole(['admin']);
  if (auth instanceof NextResponse) return auth;
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id обязателен' }, { status: 400 });
  const existing = await prisma.roleReservation.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });
  await prisma.roleReservation.delete({ where: { id } });
  await writeAudit({
    actorType: 'user',
    actorId: auth.userId,
    action: 'reservation.delete',
    entityType: 'roleReservation',
    entityId: id,
    meta: { role: existing.role, hoursPerWeek: existing.hoursPerWeek },
    ip: clientIp(req),
  });
  return NextResponse.json({ ok: true });
}
