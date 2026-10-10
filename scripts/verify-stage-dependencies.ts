/**
 * #103 WP-5e: зависимости этапов против живой, мигрированной PostgreSQL.
 * Проверяет то, чего не видят юнит-тесты: CHECK (тип, пауза, петля), уникальность
 * пары, каскады при удалении этапа и расчёта, перенос зависимостей при
 * перестройке этапов (rebuildStages), замену набора с перестройкой Ганта на
 * месте, применение сдвига по календарю и то, что сравнение вариантов ничего
 * не пишет. Также — сохранение PlanScenario.
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { rebuildStages, scheduleConfigFromTemplate } from '../lib/calc';
import {
  DependencyError,
  loadCalcPlans,
  loadEarliestStart,
  loadVariantComparison,
  replaceDependencies,
  rescheduleOps,
} from '../lib/planningData';

async function rejects(label: string, action: () => Promise<unknown>) {
  await assert.rejects(action, `${label}: database must reject`);
}

const DAY = 86_400_000;

async function main() {
  const marker = randomUUID().slice(0, 8);
  // 2031-03-03 — понедельник; праздник в понедельник через две недели.
  const monday = new Date('2031-03-03T00:00:00Z');
  const holiday = new Date('2031-03-17T00:00:00Z');
  const calendar = await prisma.workCalendar.create({
    data: {
      name: `deps-calendar-${marker}`,
      createdBy: 'ci',
      exceptions: { create: { date: holiday, kind: 'holiday', createdBy: 'ci' } },
    },
  });
  const template = await prisma.formTemplate.create({
    data: { name: `deps-probe-${marker}`, calendarId: calendar.id, workDayHours: 6 },
  });
  const capacityIds: string[] = [];
  try {
    const config = await scheduleConfigFromTemplate(template);
    const calculation = await prisma.calculation.create({
      data: {
        templateId: template.id,
        name: `deps-calc-${marker}`,
        customer: 'CI',
        answers: '{}',
        status: 'draft',
        startDate: monday,
      },
    });
    const primary = [
      { name: 'A', role: 'architect', hours: 12 },
      { name: 'B', role: 'architect', hours: 6 },
      { name: 'C', role: 'architect', hours: 6 },
    ];
    let stages = await rebuildStages(calculation.id, primary, monday, config);
    const [a, b, c] = stages;

    // 1. CHECK и уникальность.
    const raw = (type: string, lag: number, from: string, to: string) =>
      prisma.$executeRawUnsafe(
        `INSERT INTO "StageDependency" ("id","calculationId","fromStageId","toStageId","type","lagDays") VALUES ($1,$2,$3,$4,$5,$6)`,
        `bad-${randomUUID()}`,
        calculation.id,
        from,
        to,
        type,
        lag,
      );
    await rejects('unknown dependency type', () => raw('SS', 0, a.id, c.id));
    await rejects('negative lag', () => raw('FS', -1, a.id, c.id));
    await rejects('self dependency', () => raw('FS', 0, a.id, a.id));
    await prisma.stageDependency.create({
      data: { calculationId: calculation.id, fromStageId: a.id, toStageId: c.id, lagDays: 1 },
    });
    await rejects('duplicate pair', () =>
      prisma.stageDependency.create({
        data: { calculationId: calculation.id, fromStageId: a.id, toStageId: c.id, lagDays: 2 },
      }),
    );

    // 2. API отклоняет цикл и ничего не пишет.
    const cycle = await replaceDependencies(calculation.id, [
      { fromStageId: c.id, toStageId: a.id, type: 'FS', lagDays: 0 },
    ]).then(
      () => null,
      (e: unknown) => e,
    );
    assert(cycle instanceof DependencyError && cycle.status === 409, 'cycle rejected with 409');
    assert.equal(
      await prisma.stageDependency.count({ where: { calculationId: calculation.id } }),
      1,
    );

    // 3. Замена набора перестраивает даты на месте (id этапов сохраняются).
    await replaceDependencies(calculation.id, [
      { fromStageId: a.id, toStageId: c.id, type: 'FS', lagDays: 2 },
    ]);
    stages = await prisma.stage.findMany({
      where: { calculationId: calculation.id },
      orderBy: { order: 'asc' },
    });
    assert.deepEqual(
      stages.map((s) => s.id),
      [a.id, b.id, c.id],
      'stage ids preserved',
    );
    // A: пн–вт; пауза ср, чт → C в пт 7.03.
    assert.equal(stages[2].startDate.toISOString(), '2031-03-07T09:00:00.000Z', 'FS + lag');

    // 4. Перестройка этапов переносит зависимость на новые строки.
    stages = await rebuildStages(
      calculation.id,
      [
        { ...primary[0], sourceStageId: a.id },
        { ...primary[1], sourceStageId: b.id },
        { ...primary[2], sourceStageId: c.id },
      ],
      monday,
      config,
    );
    const carried = await prisma.stageDependency.findMany({
      where: { calculationId: calculation.id },
    });
    assert.equal(carried.length, 1, 'dependency carried over');
    assert.equal(carried[0].fromStageId, stages[0].id);
    assert.equal(carried[0].toStageId, stages[2].id);
    assert.equal(carried[0].lagDays, 2);
    assert.equal(stages[2].startDate.toISOString(), '2031-03-07T09:00:00.000Z');

    // 5. Варианты не пишут: даты и updatedAt не меняются.
    const capacity = await prisma.roleCapacity.create({
      data: {
        role: 'architect',
        headcount: 1,
        hoursPerWeek: 30,
        effectiveFrom: new Date('2031-01-01T00:00:00Z'),
        createdBy: 'ci',
      },
    });
    capacityIds.push(capacity.id);
    const snapshot = JSON.stringify(
      await prisma.calculation.findUnique({
        where: { id: calculation.id },
        include: { stages: true, stageDependencies: true },
      }),
    );
    const comparison = await loadVariantComparison({ from: monday, weeks: 6 }, [
      {
        id: 'v',
        label: 'shift',
        changes: [{ type: 'shift', calculationId: calculation.id, shiftDays: 14 }],
      },
    ]);
    assert(comparison.variants[0].ends[0].endDate, 'variant has an end date');
    const earliest = await loadEarliestStart(calculation.id, { from: monday, includeDrafts: true });
    assert(earliest?.startDate, 'earliest start found');
    assert.equal(
      JSON.stringify(
        await prisma.calculation.findUnique({
          where: { id: calculation.id },
          include: { stages: true, stageDependencies: true },
        }),
      ),
      snapshot,
      'variants and earliest start never write',
    );

    // 6. Применение сдвига по календарю: старт попадает на праздник 17.03 → вт 18.03.
    const plan = (await loadCalcPlans([calculation.id])).get(calculation.id)!;
    await prisma.$transaction(rescheduleOps(plan, new Date(monday.getTime() + 14 * DAY)));
    const shifted = await prisma.stage.findMany({
      where: { calculationId: calculation.id },
      orderBy: { order: 'asc' },
    });
    assert.equal(shifted[0].startDate.toISOString(), '2031-03-18T09:00:00.000Z', 'holiday skipped');
    assert.equal(
      comparison.variants[0].ends[0].endDate,
      new Date(Math.max(...shifted.map((s) => s.endDate.getTime()))).toISOString(),
      'what-if end equals applied end',
    );

    // 7. PlanScenario.
    const scenario = await prisma.planScenario.create({
      data: { name: `ci-${marker}`, createdBy: 'ci', variants: [], result: { ok: true } },
    });
    await rejects('empty scenario name', () =>
      prisma.planScenario.create({ data: { name: '', createdBy: 'ci', variants: [], result: {} } }),
    );
    await prisma.planScenario.delete({ where: { id: scenario.id } });

    // 8. Каскады: удаление этапа снимает зависимость, удаление расчёта — все.
    await prisma.stage.delete({ where: { id: shifted[0].id } });
    assert.equal(
      await prisma.stageDependency.count({ where: { calculationId: calculation.id } }),
      0,
    );
    await prisma.stageDependency.create({
      data: {
        calculationId: calculation.id,
        fromStageId: shifted[1].id,
        toStageId: shifted[2].id,
      },
    });
    await prisma.calculation.delete({ where: { id: calculation.id } });
    assert.equal(
      await prisma.stageDependency.count({ where: { calculationId: calculation.id } }),
      0,
    );
  } finally {
    await prisma.roleCapacity.deleteMany({ where: { id: { in: capacityIds } } });
    await prisma.calculation.deleteMany({ where: { templateId: template.id } });
    await prisma.formTemplate.delete({ where: { id: template.id } });
    await prisma.workCalendar.deleteMany({ where: { id: calendar.id } });
  }
  console.log(
    'Stage dependencies integration passed: CHECKs, unique pair, cycle rejected, carry-over on rebuild, in-place reschedule, variants read-only, apply follows the calendar, cascades.',
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
