import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiRole } from '@/lib/auth';
import { clientIp, writeAudit } from '@/lib/audit';
import { parseExceptionInput, parseExceptionLines, type ExceptionInput } from '@/lib/calendarAdmin';

export const dynamic = 'force-dynamic';

/**
 * Исключения календаря: одна дата ({date, kind, hours?, note?}) или пакет
 * строк ({lines}). Повтор даты заменяет прежнее исключение этой даты.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const auth = await requireApiRole(['admin']);
  if (auth instanceof NextResponse) return auth;
  const body = await req.json().catch(() => ({}));
  let items: ExceptionInput[];
  if (typeof body?.lines === 'string') {
    const parsed = parseExceptionLines(body.lines);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    items = parsed.value;
  } else {
    const parsed = parseExceptionInput(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    items = [parsed.value];
  }
  const calendar = await prisma.workCalendar.findUnique({ where: { id } });
  if (!calendar) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const rows = await prisma.$transaction(
    items.map((e) =>
      prisma.calendarException.upsert({
        where: { calendarId_date: { calendarId: id, date: e.date } },
        create: { calendarId: id, ...e, createdBy: auth.userId },
        update: { kind: e.kind, hours: e.hours, note: e.note, createdBy: auth.userId },
      }),
    ),
  );
  await prisma.workCalendar.update({ where: { id }, data: { updatedAt: new Date() } });
  await writeAudit({
    actorType: 'user',
    actorId: auth.userId,
    action: 'calendar.exceptions.upsert',
    entityType: 'workCalendar',
    entityId: id,
    meta: {
      count: rows.length,
      dates: items.slice(0, 50).map((e) => `${e.date.toISOString().slice(0, 10)}:${e.kind}`),
    },
    ip: clientIp(req),
  });
  return NextResponse.json(rows, { status: 201 });
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const auth = await requireApiRole(['admin']);
  if (auth instanceof NextResponse) return auth;
  const exceptionId = req.nextUrl.searchParams.get('exceptionId');
  if (!exceptionId) return NextResponse.json({ error: 'exceptionId обязателен' }, { status: 400 });
  const existing = await prisma.calendarException.findUnique({ where: { id: exceptionId } });
  if (!existing || existing.calendarId !== id) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  await prisma.calendarException.delete({ where: { id: exceptionId } });
  await writeAudit({
    actorType: 'user',
    actorId: auth.userId,
    action: 'calendar.exceptions.delete',
    entityType: 'workCalendar',
    entityId: id,
    meta: { date: existing.date.toISOString().slice(0, 10), kind: existing.kind },
    ip: clientIp(req),
  });
  return NextResponse.json({ ok: true });
}
