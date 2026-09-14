import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiRole } from '@/lib/auth';
import { clientIp, writeAudit } from '@/lib/audit';
import { normalizeConfig } from '@/lib/deviations';
import { listSavedReports } from '@/lib/deviationsData';

export const dynamic = 'force-dynamic';

const STAFF = ['presale', 'architect', 'reviewer', 'admin'];

/** Сохранённые срезы конструктора (E3): общие для всех сотрудников. */
export async function GET() {
  const auth = await requireApiRole(STAFF);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json(await listSavedReports());
}

export async function POST(req: NextRequest) {
  const auth = await requireApiRole(STAFF);
  if (auth instanceof NextResponse) return auth;
  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? '')
    .trim()
    .slice(0, 120);
  if (!name) return NextResponse.json({ error: 'Укажите название среза' }, { status: 400 });
  const config = normalizeConfig(body.config);
  if (body.id) {
    const existing = await prisma.deviationReport.findUnique({ where: { id: String(body.id) } });
    if (!existing) return NextResponse.json({ error: 'Срез не найден' }, { status: 404 });
    if (existing.createdBy !== auth.userId && auth.role !== 'admin') {
      return NextResponse.json(
        { error: 'Изменить может автор или администратор; сохраните как новый срез' },
        { status: 403 },
      );
    }
  }
  const row = body.id
    ? await prisma.deviationReport.update({
        where: { id: String(body.id) },
        data: { name, config: JSON.stringify(config) },
      })
    : await prisma.deviationReport.create({
        data: { name, config: JSON.stringify(config), createdBy: auth.userId },
      });
  await writeAudit({
    actorType: 'user',
    actorId: auth.userId,
    action: body.id ? 'deviationReport.update' : 'deviationReport.create',
    entityType: 'deviationReport',
    entityId: row.id,
    meta: { name },
    ip: clientIp(req),
  });
  return NextResponse.json({ id: row.id, name: row.name, config });
}

/** Удалить может автор или админ. */
export async function DELETE(req: NextRequest) {
  const auth = await requireApiRole(STAFF);
  if (auth instanceof NextResponse) return auth;
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id обязателен' }, { status: 400 });
  const existing = await prisma.deviationReport.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (existing.createdBy !== auth.userId && auth.role !== 'admin') {
    return NextResponse.json({ error: 'Удалить может автор или администратор' }, { status: 403 });
  }
  await prisma.deviationReport.delete({ where: { id } });
  await writeAudit({
    actorType: 'user',
    actorId: auth.userId,
    action: 'deviationReport.delete',
    entityType: 'deviationReport',
    entityId: id,
    meta: { name: existing.name },
    ip: clientIp(req),
  });
  return NextResponse.json({ ok: true });
}
