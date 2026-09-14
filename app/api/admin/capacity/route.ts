import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiRole } from '@/lib/auth';
import { clientIp, writeAudit } from '@/lib/audit';
import { ROLES } from '@/lib/roles';

export const dynamic = 'force-dynamic';

/** Ёмкость ролей (E2). Читают архитектор и админ, пишет только админ. */
export async function GET() {
  const auth = await requireApiRole(['architect', 'reviewer', 'admin']);
  if (auth instanceof NextResponse) return auth;
  const rows = await prisma.roleCapacity.findMany({
    orderBy: [{ role: 'asc' }, { effectiveFrom: 'desc' }],
  });
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const auth = await requireApiRole(['admin']);
  if (auth instanceof NextResponse) return auth;
  const body = await req.json().catch(() => ({}));
  const role = String(body.role ?? '');
  if (!ROLES.some((r) => r.value === role) || role === 'customer') {
    return NextResponse.json({ error: 'Недопустимая роль' }, { status: 400 });
  }
  const headcount = Number(body.headcount);
  const hoursPerWeek = body.hoursPerWeek === undefined ? 30 : Number(body.hoursPerWeek);
  const effectiveFrom = new Date(String(body.effectiveFrom ?? ''));
  if (!Number.isFinite(headcount) || headcount < 0) {
    return NextResponse.json({ error: 'Ставок: неотрицательное число' }, { status: 400 });
  }
  if (!Number.isFinite(hoursPerWeek) || hoursPerWeek <= 0 || hoursPerWeek > 80) {
    return NextResponse.json({ error: 'Часов в неделю: от 1 до 80' }, { status: 400 });
  }
  if (Number.isNaN(effectiveFrom.getTime())) {
    return NextResponse.json({ error: 'Некорректная дата начала действия' }, { status: 400 });
  }
  const row = await prisma.roleCapacity.create({
    data: {
      role,
      headcount,
      hoursPerWeek,
      effectiveFrom,
      note: String(body.note ?? '').trim() || null,
      createdBy: auth.userId,
    },
  });
  await writeAudit({
    actorType: 'user',
    actorId: auth.userId,
    action: 'capacity.create',
    entityType: 'roleCapacity',
    entityId: row.id,
    meta: { role, headcount, hoursPerWeek, effectiveFrom: effectiveFrom.toISOString() },
    ip: clientIp(req),
  });
  return NextResponse.json(row, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireApiRole(['admin']);
  if (auth instanceof NextResponse) return auth;
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id обязателен' }, { status: 400 });
  const existing = await prisma.roleCapacity.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });
  await prisma.roleCapacity.delete({ where: { id } });
  await writeAudit({
    actorType: 'user',
    actorId: auth.userId,
    action: 'capacity.delete',
    entityType: 'roleCapacity',
    entityId: id,
    meta: { role: existing.role, headcount: existing.headcount },
    ip: clientIp(req),
  });
  return NextResponse.json({ ok: true });
}
