/** Предложения нормативов (#103 WP-6c) на живой PostgreSQL: генерация по факту
 * журнала, полнота и потолок достоверности, идемпотентная перегенерация,
 * утверждение меняет только этап шаблона (этапы расчётов — нет), CHECK и
 * частичный уникальный индекс открытых предложений.
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { MANUAL_SOURCE, manualExternalId } from '../lib/actualsLedger';
import { recomputeStageActuals } from '../lib/actualsLedgerData';
import { decideNormProposal, generateNormProposals } from '../lib/normProposalsData';

async function main() {
  const template = await prisma.formTemplate.create({
    data: {
      name: `norms-${randomUUID()}`,
      fields: { create: [{ label: 'Площадки', key: 'sites', type: 'number' }] },
      stageTemplates: {
        create: [
          {
            name: 'Обследование',
            role: 'analyst',
            baseHours: 10,
            hoursPerUnit: 2,
            driverFieldKey: 'sites',
          },
          { name: 'Проектирование', role: 'architect', baseHours: 40, order: 1 },
        ],
      },
    },
    include: { stageTemplates: true },
  });
  const survey = template.stageTemplates.find((s) => s.name === 'Обследование')!;
  const design = template.stageTemplates.find((s) => s.name === 'Проектирование')!;
  const projectIds: string[] = [];
  const day = new Date('2026-03-01T00:00:00Z');

  /** Выигранный проект с закрытым фактом; actual === null — факт не вносился. */
  async function wonProject(i: number, surveyActual: number | null, designActual: number | null) {
    const project = await prisma.project.create({
      data: { name: `norms-${i}`, customer: 'CI', dealStatus: 'won' },
    });
    projectIds.push(project.id);
    const calc = await prisma.calculation.create({
      data: {
        templateId: template.id,
        projectId: project.id,
        name: `Проект ${i}`,
        customer: 'CI',
        answers: JSON.stringify({ sites: 5 }), // Обследование по формуле 20 ч
        status: 'approved',
        stages: {
          create: [
            {
              name: 'Обследование',
              role: 'analyst',
              hours: 22,
              order: 0,
              startDate: day,
              endDate: day,
            },
            {
              name: 'Проектирование',
              role: 'architect',
              hours: 40,
              order: 1,
              startDate: day,
              endDate: day,
            },
          ],
        },
      },
      include: { stages: true },
    });
    for (const [name, hours] of [
      ['Обследование', surveyActual],
      ['Проектирование', designActual],
    ] as const) {
      if (hours === null) continue;
      const stage = calc.stages.find((s) => s.name === name)!;
      await prisma.actualEntry.create({
        data: {
          calculationId: calc.id,
          stageId: stage.id,
          source: MANUAL_SOURCE,
          externalId: manualExternalId(stage.id),
          hours,
        },
      });
      await prisma.$transaction((tx) => recomputeStageActuals(tx, [stage.id]));
    }
    await prisma.project.update({
      where: { id: project.id },
      data: { wonCalculationId: calc.id, actualsClosedAt: new Date() },
    });
    return calc;
  }

  try {
    // Обследование: 3 полных наблюдения (30 ч при формуле 20) + один этап без факта.
    // Проектирование: факт только у двух проектов.
    await wonProject(1, 30, 60);
    await wonProject(2, 30, 60);
    await wonProject(3, 30, null);
    await wonProject(4, null, null);

    // 1. Генерация: пропуск факта не считается нулём, малая выборка — низкая.
    const first = await generateNormProposals(template.id, 'ci');
    assert.equal(first.created, 2);
    const s1 = await prisma.normProposal.findFirstOrThrow({
      where: { stageTemplateId: survey.id, status: 'proposed' },
    });
    assert.equal(s1.sampleSize, 3);
    assert.equal(s1.completeness, 0.75);
    assert.equal(s1.confidence, 'medium');
    assert.equal(s1.proposedBaseHours, 15);
    assert.equal(s1.proposedHoursPerUnit, 3);
    const d1 = await prisma.normProposal.findFirstOrThrow({
      where: { stageTemplateId: design.id, status: 'proposed' },
    });
    assert.equal(d1.sampleSize, 2);
    assert.equal(d1.completeness, 0.5);
    assert.equal(d1.confidence, 'low', 'малая и неполная выборка — только низкая');
    const expl = d1.explanation as { samples: { calculationId: string; status: string }[] };
    assert.equal(expl.samples.filter((s) => s.status === 'no-actuals').length, 2);

    // 2. Повтор с теми же данными ничего не создаёт.
    const again = await generateNormProposals(template.id, 'ci');
    assert.deepEqual([again.created, again.unchanged, again.superseded], [0, 2, 0]);

    // 3. Новые данные: прежнее открытое предложение заменяется.
    await wonProject(5, 40, 60);
    const third = await generateNormProposals(template.id, 'ci');
    assert.equal(third.created, 2);
    assert.equal(third.superseded, 2);
    assert.equal(
      (await prisma.normProposal.findUniqueOrThrow({ where: { id: s1.id } })).status,
      'superseded',
    );

    // 4. Утверждение меняет только этап шаблона, этапы расчётов остаются прежними.
    const stagesBefore = await prisma.stage.findMany({
      where: { calculation: { templateId: template.id } },
      select: { id: true, hours: true, actualHours: true },
      orderBy: { id: 'asc' },
    });
    const open = await prisma.normProposal.findFirstOrThrow({
      where: { stageTemplateId: survey.id, status: 'proposed' },
    });
    const res = await decideNormProposal({
      formTemplateId: template.id,
      proposalId: open.id,
      decision: 'approve',
      decidedBy: 'ci-admin',
      comment: 'по факту',
    });
    assert(res.ok, 'утверждено');
    const st = await prisma.stageTemplate.findUniqueOrThrow({ where: { id: survey.id } });
    assert.equal(st.baseHours, open.proposedBaseHours);
    assert.equal(st.hoursPerUnit, open.proposedHoursPerUnit);
    const stagesAfter = await prisma.stage.findMany({
      where: { calculation: { templateId: template.id } },
      select: { id: true, hours: true, actualHours: true },
      orderBy: { id: 'asc' },
    });
    assert.deepEqual(stagesAfter, stagesBefore, 'этапы существующих расчётов не изменились');
    const approved = await prisma.normProposal.findUniqueOrThrow({ where: { id: open.id } });
    assert.equal(approved.status, 'approved');
    assert.equal(approved.decidedBy, 'ci-admin');
    assert(approved.decidedAt);

    // 5. Устаревший снимок: норматив изменили вручную — утверждение отклоняется.
    const openDesign = await prisma.normProposal.findFirstOrThrow({
      where: { stageTemplateId: design.id, status: 'proposed' },
    });
    await prisma.stageTemplate.update({ where: { id: design.id }, data: { baseHours: 41 } });
    const stale = await decideNormProposal({
      formTemplateId: template.id,
      proposalId: openDesign.id,
      decision: 'approve',
      decidedBy: 'ci-admin',
      comment: null,
    });
    assert(!stale.ok && stale.status === 409);
    assert.equal(
      (await prisma.stageTemplate.findUniqueOrThrow({ where: { id: design.id } })).baseHours,
      41,
    );

    // 5a. Перегенерация после ручной правки: новый снимок, устаревшее — superseded.
    const regen = await generateNormProposals(template.id, 'ci');
    assert.equal(regen.created, 1);
    const fresh = await prisma.normProposal.findFirstOrThrow({
      where: { stageTemplateId: design.id, status: 'proposed' },
    });
    assert.equal(fresh.currentBaseHours, 41);
    assert.equal(fresh.currentStageName, 'Проектирование');
    assert.equal(fresh.currentDriverFieldKey, null);

    // 5b. Сменили драйвер этапа — утверждение 409, норматив не тронут.
    await prisma.stageTemplate.update({
      where: { id: design.id },
      data: { driverFieldKey: 'sites' },
    });
    const driverChanged = await decideNormProposal({
      formTemplateId: template.id,
      proposalId: fresh.id,
      decision: 'approve',
      decidedBy: 'ci-admin',
      comment: null,
    });
    assert(!driverChanged.ok && driverChanged.status === 409, 'смена драйвера — 409');
    assert.equal(
      (await prisma.stageTemplate.findUniqueOrThrow({ where: { id: design.id } })).baseHours,
      41,
    );
    await prisma.stageTemplate.update({ where: { id: design.id }, data: { driverFieldKey: null } });

    // 5c. Отклонённое не возвращается при перегенерации с теми же данными.
    const rejected = await decideNormProposal({
      formTemplateId: template.id,
      proposalId: fresh.id,
      decision: 'reject',
      decidedBy: 'ci-admin',
      comment: 'мало данных',
    });
    assert(rejected.ok);
    const afterReject = await generateNormProposals(template.id, 'ci');
    assert.equal(afterReject.created, 0);
    assert(
      afterReject.skipped.some(
        (s) => s.stageTemplateId === design.id && s.reason === 'rejected-same-data',
      ),
      'rejected-same-data',
    );
    assert.equal(
      await prisma.normProposal.count({
        where: { stageTemplateId: design.id, status: 'proposed' },
      }),
      0,
    );

    // 6. Ограничения БД.
    const base = {
      stageTemplateId: design.id,
      formTemplateId: template.id,
      currentStageName: 'Проектирование',
      currentStageRole: 'architect',
      currentBaseHours: 41,
      currentHoursPerUnit: 0,
      proposedBaseHours: 50,
      proposedHoursPerUnit: 0,
      completeness: 1,
      explanation: {},
      fingerprint: 'x',
      status: 'rejected',
      decidedAt: new Date(),
    };
    await assert.rejects(
      prisma.normProposal.create({ data: { ...base, sampleSize: 2, confidence: 'medium' } }),
      'малая выборка не может быть средней',
    );
    await assert.rejects(
      prisma.normProposal.create({ data: { ...base, sampleSize: 5, confidence: 'high' } }),
      'высокая только от 8 наблюдений',
    );
    await assert.rejects(
      prisma.normProposal.create({
        data: { ...base, sampleSize: 9, completeness: 0.6, confidence: 'medium' },
      }),
      'неполная выборка не может быть средней',
    );
    const openRow = {
      ...base,
      sampleSize: 3,
      confidence: 'low',
      status: 'proposed',
      decidedAt: null,
    };
    await prisma.normProposal.create({ data: openRow });
    await assert.rejects(
      prisma.normProposal.create({ data: openRow }),
      'второе открытое предложение на этап запрещено',
    );
    await assert.rejects(
      prisma.normProposal.create({
        data: { ...base, sampleSize: 3, confidence: 'low', proposedBaseHours: -1 },
      }),
      'отрицательный норматив запрещён',
    );
    await assert.rejects(
      prisma.normProposal.create({ data: { ...base, sampleSize: 3, confidence: 'unknown' } }),
    );

    console.log(
      'Norm proposals integration passed: ledger actuals sample, missing actuals not zero, low confidence for small/incomplete samples, idempotent regeneration with supersede, approval updates only StageTemplate, stale snapshot (norm, driver) rejected, rejected proposal not re-created, DB constraints.',
    );
  } finally {
    await prisma.calculation.deleteMany({ where: { templateId: template.id } });
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    await prisma.formTemplate.delete({ where: { id: template.id } });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
