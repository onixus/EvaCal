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
import { recordManualStageEdit } from '../lib/actualsLedgerData';
import { primaryInputsFromStageRows } from '../lib/scheduling';
import {
  DependencyError,
  loadCalcPlans,
  loadEarliestStart,
  loadVariantComparison,
  replaceDependencies,
  shiftCalculation,
} from '../lib/planningData';
import { reschedulePlan } from '../lib/planning';

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

    // 4. Перестройка этапов обновляет строки на месте: факт, журнал факта и
    //    зависимость сохраняются; удалённый этап оставляет записи журнала без этапа.
    await prisma.$transaction(async (tx) => {
      await recordManualStageEdit(tx, {
        calculationId: calculation.id,
        stageId: a.id,
        hours: 10,
        startDate: monday,
      });
      await recordManualStageEdit(tx, { calculationId: calculation.id, stageId: b.id, hours: 4 });
    });
    const ledgerBefore = await prisma.actualEntry.findMany({
      where: { calculationId: calculation.id },
      orderBy: { id: 'asc' },
    });
    assert.equal(ledgerBefore.length, 2, 'ledger has entries for A and B');
    stages = await rebuildStages(
      calculation.id,
      [
        { ...primary[0], hours: 14, sourceStageId: a.id },
        // B убран; C — без id, узнаётся по названию и роли; D — новый.
        { ...primary[2] },
        { name: 'D', role: 'architect', hours: 3 },
      ],
      monday,
      config,
    );
    assert.equal(stages[0].id, a.id, 'A row kept');
    assert.equal(stages[1].id, c.id, 'C row kept by name + role');
    assert.equal(stages[0].hours, 14, 'plan fields updated');
    assert.equal(stages[0].actualHours, 10, 'stage actual aggregate kept');
    assert.equal(await prisma.stage.count({ where: { id: b.id } }), 0, 'removed stage deleted');
    const ledgerAfter = await prisma.actualEntry.findMany({
      where: { calculationId: calculation.id },
      orderBy: { id: 'asc' },
    });
    assert.equal(ledgerAfter.length, 2, 'ledger entries kept');
    assert.equal(
      ledgerAfter.reduce((s, e) => s + (e.hours ?? 0), 0),
      14,
      'ledger totals unchanged',
    );
    assert.equal(ledgerAfter.find((e) => e.hours === 10)?.stageId, a.id, 'A entry still on A');
    assert.equal(ledgerAfter.find((e) => e.hours === 4)?.stageId, null, 'B entry unassigned');
    const carried = await prisma.stageDependency.findMany({
      where: { calculationId: calculation.id },
    });
    assert.equal(carried.length, 1, 'dependency carried over');
    assert.equal(carried[0].fromStageId, a.id);
    assert.equal(carried[0].toStageId, c.id);
    assert.equal(carried[0].lagDays, 2);

    // Обратно к A/B/C (B — новая строка), зависимость A → C на месте.
    stages = await rebuildStages(
      calculation.id,
      [
        { ...primary[0], sourceStageId: a.id },
        { ...primary[1] },
        { ...primary[2], sourceStageId: c.id },
      ],
      monday,
      config,
    );
    assert.equal(stages[2].startDate.toISOString(), '2031-03-07T09:00:00.000Z');

    // 4a. Своя длительность согласования переживает «загрузить → сохранить».
    const approvalCalc = await prisma.calculation.create({
      data: {
        templateId: template.id,
        name: `deps-approval-${marker}`,
        customer: 'CI',
        answers: '{}',
        startDate: monday,
      },
    });
    await rebuildStages(
      approvalCalc.id,
      [{ name: 'ТЗ', role: 'analyst', hours: 6, approvalDays: 5 }],
      monday,
      config,
    );
    for (let round = 0; round < 2; round++) {
      const rows = await prisma.stage.findMany({
        where: { calculationId: approvalCalc.id },
        orderBy: { order: 'asc' },
      });
      await rebuildStages(approvalCalc.id, primaryInputsFromStageRows(rows), monday, config);
    }
    const approvalRows = await prisma.stage.findMany({
      where: { calculationId: approvalCalc.id },
      orderBy: { order: 'asc' },
    });
    assert.deepEqual(
      approvalRows.map((r) => r.approvalDays),
      [5, 5],
      'custom approval duration kept after reload/save',
    );

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
    const newStart = await shiftCalculation(calculation.id, 14);
    assert.equal(newStart?.getTime(), monday.getTime() + 14 * DAY, 'start moved by 14 days');
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

    // 6a. Конкурентные правки под одной блокировкой расчёта: перестройка этапов,
    //     замена зависимостей и apply не смешиваются — итог согласован.
    const before = await prisma.stage.findMany({
      where: { calculationId: calculation.id },
      orderBy: { order: 'asc' },
    });
    const config2 = await scheduleConfigFromTemplate(template);
    const results = await Promise.allSettled([
      rebuildStages(
        calculation.id,
        before
          .filter((s) => !s.isApprovalTask)
          .map((s) => ({ name: s.name, role: s.role, hours: s.hours + 1, sourceStageId: s.id })),
        new Date(monday.getTime() + 14 * DAY),
        config2,
      ),
      replaceDependencies(calculation.id, [
        { fromStageId: before[0].id, toStageId: before[2].id, type: 'FS', lagDays: 3 },
      ]),
      shiftCalculation(calculation.id, 0),
    ]);
    for (const r of results) {
      assert.equal(
        r.status,
        'fulfilled',
        `concurrent edit failed: ${String((r as PromiseRejectedResult).reason)}`,
      );
    }
    const settled = (await loadCalcPlans([calculation.id])).get(calculation.id)!;
    const rows = await prisma.stage.findMany({
      where: { calculationId: calculation.id },
      orderBy: { order: 'asc' },
    });
    assert.deepEqual(
      rows.map((s) => s.id),
      before.map((s) => s.id),
      'concurrent edits keep stage ids',
    );
    const expected = reschedulePlan(settled, settled.startDate);
    assert.deepEqual(
      rows.map((s) => s.endDate.toISOString()),
      expected.map((s) => s.endDate.toISOString()),
      'stored dates match the final hours and dependencies (no lost update)',
    );
    const finalDeps = await prisma.stageDependency.findMany({
      where: { calculationId: calculation.id },
    });
    assert(
      finalDeps.every(
        (d) => rows.some((s) => s.id === d.fromStageId) && rows.some((s) => s.id === d.toStageId),
      ),
      'dependencies point at existing stages',
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
