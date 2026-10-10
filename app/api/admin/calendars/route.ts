import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiRole } from '@/lib/auth';
import { clientIp, writeAudit } from '@/lib/audit';
import { parseCalendarInput } from '@/lib/calendarAdmin';

export const dynamic = 'force-dynamic';

/**
 * Производственные календари (#103 WP-5d). Читают сотрудники, планирующие
 * сроки; создаёт и меняет только админ. Ровно один календарь — по умолчанию.
 */
export async function GET() {
  const auth = await requireApiRole(['architect', 'gap', 'techwriter', 'reviewer', 'admin']);
  if (auth instanceof NextResponse) return auth;
  const rows = await prisma.workCalendar.findMany({
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    include: {
      exceptions: { orderBy: { date: 'asc' } },
      _count: { select: { templates: true } },
    },
  });
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const auth = await requireApiRole(['admin']);
  if (auth instanceof NextResponse) return auth;
  const parsed = parseCalendarInput(await req.json().catch(() => ({})));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { name, weekendDays, note, isDefault } = parsed.value;
  const row = await prisma.$transaction(async (tx) => {
    // Первый календарь в пустой базе сразу становится календарём по умолчанию.
    const makeDefault = Boolean(isDefault) || (await tx.workCalendar.count()) === 0;
    if (makeDefault) await tx.workCalendar.updateMany({ data: { isDefault: false } });
    return tx.workCalendar.create({
      data: {
        name: name!,
        weekendDays: weekendDays ?? '6,7',
        note: note ?? null,
        isDefault: makeDefault,
        createdBy: auth.userId,
      },
    });
  });
  await writeAudit({
    actorType: 'user',
    actorId: auth.userId,
    action: 'calendar.create',
    entityType: 'workCalendar',
    entityId: row.id,
    meta: { name: row.name, weekendDays: row.weekendDays, isDefault: row.isDefault },
    ip: clientIp(req),
  });
  return NextResponse.json(row, { status: 201 });
}
