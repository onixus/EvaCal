/**
 * #103 WP-5d: производственные календари и резервы против живой, мигрированной
 * PostgreSQL. Проверяет то, чего не видят юнит-тесты: частичный уникальный
 * индекс «один основной календарь», CHECK-ограничения, каскады и то, что Гант
 * (rebuildStages) и ресурсный план (loadCapacityMatrix) читают один календарь.
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { rebuildStages, scheduleConfigFromTemplate } from '../lib/calc';
import { loadCapacityMatrix } from '../lib/capacityData';
import { scheduleItems, expandWithApprovals } from '../lib/scheduling';
import { weekStart } from '../lib/capacity';
import { isSingleDefaultViolation } from '../lib/calendarAdmin';

async function rejects(label: string, action: () => Promise<unknown>) {
  await assert.rejects(action, `${label}: database must reject`);
}

async function main() {
  const marker = randomUUID().slice(0, 8);

  // 1. Миграция создала ровно один основной календарь.
  const defaults = await prisma.workCalendar.findMany({ where: { isDefault: true } });
  assert.equal(defaults.length, 1, 'exactly one default calendar after migration/seed');
  const duplicate = await prisma.workCalendar
    .create({ data: { name: `dup-default-${marker}`, isDefault: true, createdBy: 'ci' } })
    .then(
      () => null,
      (error: unknown) => error,
    );
  assert(duplicate, 'second default calendar: database must reject');
  assert(
    isSingleDefaultViolation(duplicate),
    `single-default violation is recognised for a 409: ${String(duplicate)}`,
  );

  const calendar = await prisma.workCalendar.create({
    data: { name: `ci-calendar-${marker}`, createdBy: 'ci' },
  });
  const template = await prisma.formTemplate.create({
    data: { name: `calendar-probe-${marker}`, calendarId: calendar.id },
  });
  const reservationIds: string[] = [];
  const capacityIds: string[] = [];
  try {
    // 2. CHECK-ограничения.
    await rejects('unknown exception kind', () =>
      prisma.$executeRawUnsafe(
        `INSERT INTO "CalendarException" ("id","calendarId","date","kind","createdBy") VALUES ($1,$2,'2031-01-01','vacation','ci')`,
        `bad-${marker}`,
        calendar.id,
      ),
    );
    await rejects('hours on a holiday', () =>
      prisma.calendarException.create({
        data: {
          calendarId: calendar.id,
          date: new Date('2031-01-02T00:00:00Z'),
          kind: 'holiday',
          hours: 4,
          createdBy: 'ci',
        },
      }),
    );
    await rejects('seven weekend days', () =>
      prisma.workCalendar.update({
        where: { id: calendar.id },
        data: { weekendDays: '1,2,3,4,5,6,7' },
      }),
    );
    await rejects('reservation ends before it starts', () =>
      prisma.roleReservation.create({
        data: {
          role: 'engineer',
          from: new Date('2031-03-10T00:00:00Z'),
          to: new Date('2031-03-03T00:00:00Z'),
          hoursPerWeek: 5,
          reason: 'ci',
          createdBy: 'ci',
        },
      }),
    );

    // 3. Праздник в календаре шаблона: Гант сдвигается, план не кладёт на него часов.
    const monday = weekStart(new Date('2031-03-05T00:00:00Z'));
    const wednesday = new Date(monday.getTime() + 2 * 86_400_000);
    await prisma.calendarException.create({
      data: { calendarId: calendar.id, date: wednesday, kind: 'holiday', createdBy: 'ci' },
    });
    await rejects('duplicate exception date', () =>
      prisma.calendarException.create({
        data: { calendarId: calendar.id, date: wednesday, kind: 'workday', createdBy: 'ci' },
      }),
    );

    const config = await scheduleConfigFromTemplate(template);
    assert.equal(config.calendar?.exceptions.size, 1, 'template calendar loaded with exception');
    const primary = [{ name: 'Монтаж', role: 'engineer', hours: 24 }];
    const calculation = await prisma.calculation.create({
      data: {
        templateId: template.id,
        name: `calendar-calc-${marker}`,
        customer: 'CI',
        answers: '{}',
        status: 'approved',
        startDate: monday,
      },
    });
    const stages = await rebuildStages(calculation.id, primary, monday, config);
    const plain = scheduleItems(expandWithApprovals(primary), monday, {
      workDayHours: config.workDayHours,
      includeWeekends: false,
    });
    assert.equal(
      stages[0].endDate.getTime() - plain[0].endDate.getTime(),
      86_400_000,
      'holiday pushes the Gantt end by one day',
    );

    const capacity = await prisma.roleCapacity.create({
      data: {
        role: 'engineer',
        headcount: 1,
        hoursPerWeek: 30,
        effectiveFrom: new Date('2031-01-01T00:00:00Z'),
        createdBy: 'ci',
      },
    });
    capacityIds.push(capacity.id);
    const query = { from: monday, weeks: 1, roles: ['engineer'] };
    const before = (await loadCapacityMatrix(query)).roles[0].cells[0];
    const own = before.items.find((i) => i.calculationId === calculation.id);
    assert.equal(own?.hours, 24, 'plan places every Gantt hour into the same week');

    // 4. Резерв уменьшает ёмкость роли ровно на свой объём (неделя без праздников основного календаря).
    const reservation = await prisma.roleReservation.create({
      data: {
        role: 'engineer',
        from: monday,
        to: new Date(monday.getTime() + 6 * 86_400_000),
        hoursPerWeek: 10,
        reason: `ci-${marker}`,
        createdBy: 'ci',
      },
    });
    reservationIds.push(reservation.id);
    const after = (await loadCapacityMatrix(query)).roles[0].cells[0];
    assert(before.capacityHours !== null && after.capacityHours !== null, 'capacity known');
    assert.equal(after.reservedHours - before.reservedHours, 10, 'cell reports reserved hours');
    assert.equal(
      Math.round((before.capacityHours - after.capacityHours) * 10) / 10,
      10,
      'reservation reduces capacity by its hours',
    );

    await prisma.calculation.delete({ where: { id: calculation.id } });

    // 5. Удаление календаря: исключения каскадом, шаблон — на основной.
    await prisma.workCalendar.delete({ where: { id: calendar.id } });
    assert.equal(await prisma.calendarException.count({ where: { calendarId: calendar.id } }), 0);
    const detached = await prisma.formTemplate.findUnique({ where: { id: template.id } });
    assert.equal(detached?.calendarId, null, 'template falls back to the default calendar');
  } finally {
    await prisma.roleReservation.deleteMany({ where: { id: { in: reservationIds } } });
    await prisma.roleCapacity.deleteMany({ where: { id: { in: capacityIds } } });
    await prisma.calculation.deleteMany({ where: { templateId: template.id } });
    await prisma.formTemplate.delete({ where: { id: template.id } });
    await prisma.workCalendar.deleteMany({ where: { id: calendar.id } });
  }
  console.log(
    'Calendars integration passed: single default, CHECKs, cascade, Gantt and capacity share the calendar, reservations reduce capacity.',
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
