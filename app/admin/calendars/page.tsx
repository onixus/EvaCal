import { prisma } from '@/lib/prisma';
import CalendarsAdmin from './CalendarsAdmin';

export const dynamic = 'force-dynamic';

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Производственные календари и резервы ролей (#103 WP-5d). Доступ — layout админки. */
export default async function CalendarsAdminPage() {
  const [calendars, reservations] = await Promise.all([
    prisma.workCalendar.findMany({
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      include: {
        exceptions: { orderBy: { date: 'asc' } },
        _count: { select: { templates: true } },
      },
    }),
    prisma.roleReservation.findMany({ orderBy: [{ from: 'desc' }, { role: 'asc' }] }),
  ]);
  return (
    <CalendarsAdmin
      calendars={calendars.map((c) => ({
        id: c.id,
        name: c.name,
        isDefault: c.isDefault,
        weekendDays: c.weekendDays,
        note: c.note,
        templates: c._count.templates,
        exceptions: c.exceptions.map((e) => ({
          id: e.id,
          date: day(e.date),
          kind: e.kind,
          hours: e.hours,
          note: e.note,
        })),
      }))}
      reservations={reservations.map((r) => ({
        id: r.id,
        role: r.role,
        from: day(r.from),
        to: day(r.to),
        hoursPerWeek: r.hoursPerWeek,
        reason: r.reason,
      }))}
    />
  );
}
