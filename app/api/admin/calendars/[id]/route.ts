import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiRole } from '@/lib/auth';
import { clientIp, writeAudit } from '@/lib/audit';
import { parseCalendarInput } from '@/lib/calendarAdmin';

export const dynamic = 'force-dynamic';

/**
 * Правка календаря. Снять признак «по умолчанию» нельзя — только назначить
 * другой календарь основным (иначе Гант и план остались бы без общего календаря).
 */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const auth = await requireApiRole(['admin']);
  if (auth instanceof NextResponse) return auth;
  const parsed = parseCalendarInput(await req.json().catch(() => ({})), true);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const existing = await prisma.workCalendar.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const { isDefault, ...fields } = parsed.value;
  if (isDefault === false && existing.isDefault) {
    return NextResponse.json(
      { error: 'Назначьте основным другой календарь — без основного нельзя' },
      { status: 409 },
    );
  }
  const row = await prisma.$transaction(async (tx) => {
    if (isDefault && !existing.isDefault) {
      await tx.workCalendar.updateMany({ where: { NOT: { id } }, data: { isDefault: false } });
    }
    return tx.workCalendar.update({
      where: { id },
      data: { ...fields, ...(isDefault ? { isDefault: true } : {}) },
    });
  });
  await writeAudit({
    actorType: 'user',
    actorId: auth.userId,
    action: 'calendar.update',
    entityType: 'workCalendar',
    entityId: id,
    meta: { ...parsed.value },
    ip: clientIp(req),
  });
  return NextResponse.json(row);
}

/** Удаление: основной календарь удалить нельзя; шаблоны переходят на основной. */
export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const auth = await requireApiRole(['admin']);
  if (auth instanceof NextResponse) return auth;
  const existing = await prisma.workCalendar.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (existing.isDefault) {
    return NextResponse.json({ error: 'Основной календарь удалить нельзя' }, { status: 409 });
  }
  await prisma.workCalendar.delete({ where: { id } });
  await writeAudit({
    actorType: 'user',
    actorId: auth.userId,
    action: 'calendar.delete',
    entityType: 'workCalendar',
    entityId: id,
    meta: { name: existing.name },
    ip: clientIp(req),
  });
  return NextResponse.json({ ok: true });
}
