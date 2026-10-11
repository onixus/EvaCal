/**
 * #103 WP-2a/2b: запросы на изменение против живой, мигрированной PostgreSQL.
 * WP-2b: принятие в одной транзакции (версия расчёта + строка ИЗМ + черновой
 * комплект + ЛВИ), откат при сбое, политика переоценки, защита базы и
 * результата от удаления.
 * Проверяет то, чего не видят юнит-тесты: CHECK-ограничения, уникальный номер
 * в проекте, append-only журнал (триггер), каскад журнала, Decimal-стоимость и
 * главное — что создание, передача на оценку и оценка запроса не меняют ни
 * одной строки базового расчёта, его этапов и комплекта.
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import {
  createChangeRequest,
  getChangeRequest,
  loadBaseFingerprint,
  recordEstimate,
  submitChangeRequest,
  updateChangeRequestDraft,
} from '../lib/changeRequests/store';
import {
  decideChangeRequest,
  deleteDraftChangeRequest,
  isChangeRequestRestrictViolation,
} from '../lib/changeRequests/decisions';
import { parseDraftInput, parseEstimateInput } from '../lib/changeRequests/workflow';

const asArchitect = (decision: 'accept' | 'reject' | 'defer' | 'reopen', comment?: string) => ({
  decision,
  actor: 'architect',
  role: 'architect',
  comment: comment ?? null,
});

const status409 = (error: unknown) => (error as { status?: number }).status === 409;

async function rejects(label: string, action: () => Promise<unknown>) {
  await assert.rejects(action, `${label}: database must reject`);
}

async function main() {
  const marker = randomUUID().slice(0, 8);
  const template = await prisma.formTemplate.create({ data: { name: `cr-probe-${marker}` } });
  const project = await prisma.project.create({
    data: { name: `cr-probe-${marker}`, customer: 'CI' },
  });
  try {
    const calculation = await prisma.calculation.create({
      data: {
        templateId: template.id,
        projectId: project.id,
        name: 'Базовый расчёт',
        customer: 'CI',
        answers: '{}',
        status: 'approved',
      },
    });
    const now = new Date('2031-01-06T00:00:00Z');
    const s1 = await prisma.stage.create({
      data: {
        calculationId: calculation.id,
        name: 'Проектирование',
        role: 'architect',
        hours: 120,
        order: 0,
        startDate: now,
        endDate: now,
      },
    });
    const s2 = await prisma.stage.create({
      data: {
        calculationId: calculation.id,
        name: 'Разработка',
        role: 'engineer',
        hours: 400,
        order: 1,
        startDate: now,
        endDate: now,
      },
    });
    const pkg = await prisma.gostPackage.create({
      data: {
        projectId: project.id,
        calculationId: calculation.id,
        name: 'Комплект',
        status: 'approved',
        standardProfileId: 'ru-gost34-current',
        standardProfileVersion: 'ci',
        generatorVersion: 'ci',
        documentTypes: '["tz","pmi"]',
        snapshot: JSON.stringify({
          requirements: [
            { id: 'R1', code: 'ТР-01', description: 'Вход по паролю', criterion: 'Вход проходит' },
            { id: 'R2', code: 'ТР-02', description: 'Журнал событий' },
          ],
          manualLinks: [
            { sourceId: 'R1', targetId: s1.id, method: 'MANUAL', approved: true },
            { sourceId: 'R2', targetId: s2.id, method: 'MANUAL', approved: true },
          ],
        }),
      },
    });

    const baseState = async () =>
      JSON.stringify([
        await prisma.calculation.findUnique({ where: { id: calculation.id } }),
        await prisma.stage.findMany({
          where: { calculationId: calculation.id },
          orderBy: { order: 'asc' },
        }),
        await prisma.gostPackage.findUnique({ where: { id: pkg.id } }),
        await prisma.project.findUnique({ where: { id: project.id } }),
      ]);
    let before = await baseState();

    // 1. Создание, правка, передача на оценку, оценка — через хранилище.
    const draftBody = {
      title: 'SSO',
      initiator: 'Заказчик',
      reason: 'ИБ',
      baseCalculationId: calculation.id,
      basePackageId: pkg.id,
      requirementIds: ['R1'],
      proposedChanges: {
        summary: 'SSO',
        items: [{ kind: 'modify', requirementId: 'R1', text: 'Вход через SAML' }],
      },
    };
    const cr = await createChangeRequest(project.id, parseDraftInput(draftBody), 'ci');
    assert.equal(cr.seq, 1);
    assert.deepEqual(
      cr.impact?.stages.map((s) => [s.id, s.baseHours]),
      [[s1.id, 120]],
    );
    const edited = await updateChangeRequestDraft(
      project.id,
      cr.id,
      parseDraftInput({ ...draftBody, requirementIds: ['R1', 'R2'] }),
      'ci',
      new Date(cr.updatedAt),
    );
    // Правка по устаревшей версии черновика — 409, ничего не пишется.
    await assert.rejects(
      updateChangeRequestDraft(
        project.id,
        cr.id,
        parseDraftInput({ ...draftBody, title: 'stale' }),
        'ci',
        new Date(cr.updatedAt),
      ),
      (error: unknown) => (error as { status?: number }).status === 409,
    );
    assert.equal((await getChangeRequest(project.id, cr.id)).title, edited.title);
    await submitChangeRequest(project.id, cr.id, 'ci', 'на оценку');
    const estimated = await recordEstimate(
      project.id,
      cr.id,
      parseEstimateInput({ hours: 24, cost: '36000.50', scheduleDays: 2 }),
      'architect',
    );
    assert.equal(estimated.confirmedHours, 24, 'hours exactly as entered');
    assert.equal(estimated.confirmedCost, '36000.50', 'decimal cost round-trips');
    assert.equal(estimated.confirmedScheduleDays, 2);
    const full = await getChangeRequest(project.id, cr.id);
    assert.deepEqual(
      full.events?.map((e) => e.action),
      ['created', 'updated', 'submitted', 'estimated'],
    );

    // Параллельное создание получает разные номера.
    const pair = await Promise.all([
      createChangeRequest(project.id, parseDraftInput({ ...draftBody, title: 'A' }), 'ci'),
      createChangeRequest(project.id, parseDraftInput({ ...draftBody, title: 'B' }), 'ci'),
    ]);
    assert.deepEqual(pair.map((p) => p.seq).sort(), [2, 3]);

    // 2. База не тронута ни одним шагом.
    assert.equal(await baseState(), before, 'base calculation, stages and package are untouched');

    // 3. CHECK-ограничения и уникальность.
    await rejects('unknown status', () =>
      prisma.changeRequest.update({ where: { id: cr.id }, data: { status: 'approved' } }),
    );
    await rejects('accepted without estimate', () =>
      prisma.changeRequest.update({
        where: { id: pair[0].id },
        data: { status: 'accepted', decidedAt: new Date(), decidedBy: 'ci' },
      }),
    );
    await rejects('decision without author', () =>
      prisma.changeRequest.update({ where: { id: cr.id }, data: { status: 'rejected' } }),
    );
    await rejects('partial estimate', () =>
      prisma.changeRequest.update({ where: { id: pair[0].id }, data: { confirmedHours: 5 } }),
    );
    await rejects('duplicate seq in project', () =>
      prisma.changeRequest.update({ where: { id: pair[0].id }, data: { seq: 1 } }),
    );
    await rejects('affectedRequirements must be an array', () =>
      prisma.changeRequest.update({
        where: { id: pair[0].id },
        data: { affectedRequirements: { id: 'R1' } },
      }),
    );
    await rejects('blank title', () =>
      prisma.changeRequest.update({ where: { id: pair[0].id }, data: { title: '   ' } }),
    );
    await rejects('unknown event action', () =>
      prisma.changeRequestEvent.create({ data: { crId: cr.id, action: 'approved', actor: 'ci' } }),
    );

    // 4. Журнал только дополняется.
    const event = await prisma.changeRequestEvent.findFirstOrThrow({ where: { crId: cr.id } });
    await rejects('event update', () =>
      prisma.changeRequestEvent.update({ where: { id: event.id }, data: { comment: 'x' } }),
    );

    // Параллельный запрос на ту же базу, поданный до принятия первого.
    await submitChangeRequest(project.id, pair[0].id, 'ci', null);
    await recordEstimate(
      project.id,
      pair[0].id,
      parseEstimateInput({ hours: 8, cost: '1000', scheduleDays: 0 }),
      'architect',
    );

    // 3a. Отпечаток базы: подписи и метка сохранения снимка не влияют, входы
    // Ганта (старт, параллельность, срок согласования, зависимости) — влияют.
    const fp = () => loadBaseFingerprint(prisma, cr);
    const fp0 = await fp();
    const snap0 = (await prisma.gostPackage.findUniqueOrThrow({ where: { id: pkg.id } })).snapshot;
    await prisma.gostPackage.update({
      where: { id: pkg.id },
      data: {
        snapshot: JSON.stringify({
          ...JSON.parse(snap0 ?? '{}'),
          signatures: { approver: 'CI' },
          updatedAt: new Date().toISOString(),
        }),
      },
    });
    assert.equal(await fp(), fp0, 'signatures/updatedAt do not stale the estimate');
    await prisma.gostPackage.update({ where: { id: pkg.id }, data: { snapshot: snap0 } });
    const startDate0 = (
      await prisma.calculation.findUniqueOrThrow({ where: { id: calculation.id } })
    ).startDate;
    for (const [label, change, undo] of [
      [
        'startDate',
        () =>
          prisma.calculation.update({
            where: { id: calculation.id },
            data: { startDate: new Date('2031-02-03T00:00:00Z') },
          }),
        () =>
          prisma.calculation.update({
            where: { id: calculation.id },
            data: { startDate: startDate0 },
          }),
      ],
      [
        'parallel',
        () => prisma.stage.update({ where: { id: s2.id }, data: { parallel: true } }),
        () => prisma.stage.update({ where: { id: s2.id }, data: { parallel: false } }),
      ],
      [
        'approvalDays',
        () => prisma.stage.update({ where: { id: s2.id }, data: { approvalDays: 5 } }),
        () => prisma.stage.update({ where: { id: s2.id }, data: { approvalDays: null } }),
      ],
      [
        'dependency',
        () =>
          prisma.stageDependency.create({
            data: { calculationId: calculation.id, fromStageId: s1.id, toStageId: s2.id },
          }),
        () => prisma.stageDependency.deleteMany({ where: { calculationId: calculation.id } }),
      ],
    ] as const) {
      await change();
      assert.notEqual(await fp(), fp0, `${label} changes the base fingerprint`);
      await undo();
      assert.equal(await fp(), fp0, `${label} restored`);
    }

    // Проверка отпечатка правила базу и вернула значения; updatedAt сдвинулся —
    // дальнейшие сравнения ведутся от нового снимка.
    before = await baseState();

    // 4a. Принятие откатывается целиком: сбой на записи строки ИЗМ.
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION "ci_fail_risk"() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'ci: risk insert blocked'; END; $$ LANGUAGE plpgsql`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER "ci_fail_risk" BEFORE INSERT ON "Risk" FOR EACH ROW EXECUTE FUNCTION "ci_fail_risk"()`,
    );
    const countsBefore = async () => [
      await prisma.calculation.count({ where: { projectId: project.id } }),
      await prisma.gostPackage.count({ where: { projectId: project.id } }),
      await prisma.internalChange.count({ where: { calculation: { projectId: project.id } } }),
      await prisma.changeRequestEvent.count({ where: { crId: cr.id } }),
    ];
    const counts = await countsBefore();
    await assert.rejects(decideChangeRequest(project.id, cr.id, asArchitect('accept')));
    await prisma.$executeRawUnsafe('DROP TRIGGER "ci_fail_risk" ON "Risk"');
    await prisma.$executeRawUnsafe('DROP FUNCTION "ci_fail_risk"()');
    assert.deepEqual(await countsBefore(), counts, 'failed accept leaves no version, package, log');
    assert.equal((await getChangeRequest(project.id, cr.id)).status, 'submitted');
    assert.equal(
      (await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).baselineCalculationId,
      null,
    );
    assert.equal(await baseState(), before, 'base untouched after failed accept');

    // 4b. Принятие: новая версия от базы, строка ИЗМ, черновой комплект, ЛВИ.
    const accepted = await decideChangeRequest(project.id, cr.id, asArchitect('accept', 'ok'));
    assert.equal(accepted.status, 'accepted');
    assert.ok(accepted.resultCalculationId && accepted.resultPackageId);
    const next = await prisma.calculation.findUniqueOrThrow({
      where: { id: accepted.resultCalculationId },
      include: { stages: true, risks: true, internalChanges: true },
    });
    assert.equal(next.parentCalculationId, calculation.id, 'version derives from the base');
    assert.equal(next.version, calculation.version + 1);
    assert.equal(next.stages.length, 2, 'stages cloned');
    const change = next.risks.find((r) => r.description.startsWith('ИЗМ-01 (ЗИ-01)'));
    assert.equal(change?.hours, 24, 'explicit change row carries the confirmed hours');
    assert.equal(
      next.stages.reduce((sum, st) => sum + st.hours, 0),
      520,
      'linked stage hours are not inflated',
    );
    assert.equal(next.internalChanges.length, 1);
    assert.equal(next.internalChanges[0].source, 'change_request');
    assert.equal(next.internalChanges[0].packageId, accepted.resultPackageId);
    const nextPkg = await prisma.gostPackage.findUniqueOrThrow({
      where: { id: accepted.resultPackageId },
    });
    assert.equal(nextPkg.status, 'draft');
    assert.equal(nextPkg.calculationId, next.id);
    assert.equal(nextPkg.version, pkg.version + 1);
    const nextSnap = JSON.parse(nextPkg.snapshot ?? '{}');
    const r1 = nextSnap.requirements.find((r: { id: string }) => r.id === 'R1');
    assert.equal(r1.description, 'Вход через SAML');
    assert.equal(r1.changeRef, 'ИЗМ-01');
    const newStageIds = new Set(next.stages.map((st) => st.id));
    assert.ok(
      nextSnap.manualLinks.every((l: { targetId: string }) => newStageIds.has(l.targetId)),
      'links point at the new version stages',
    );
    assert.equal(
      (await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).baselineCalculationId,
      calculation.id,
      'baseline frozen on first accepted change',
    );
    // Расчёт, этапы и комплект базы байт-в-байт прежние; у проекта поменялась
    // только зафиксированная первоначальная база.
    const withoutProject = (state: string) => JSON.stringify(JSON.parse(state).slice(0, 3));
    assert.equal(
      withoutProject(await baseState()),
      withoutProject(before),
      'base byte-identical after accept',
    );

    // 4c. Цепочка: параллельная ветка от той же базы не принимается, новый
    // запрос оформляется только на результате, черновик комплекта базой не бывает.
    await assert.rejects(
      decideChangeRequest(project.id, pair[0].id, asArchitect('accept')),
      status409,
    );
    await assert.rejects(
      createChangeRequest(project.id, parseDraftInput({ ...draftBody, title: 'stale' }), 'ci'),
      (error: unknown) => /текущая согласованная версия/.test(String(error)),
    );
    await assert.rejects(
      createChangeRequest(
        project.id,
        parseDraftInput({ ...draftBody, baseCalculationId: next.id, basePackageId: nextPkg.id }),
        'ci',
      ),
      (error: unknown) => /выпущенный комплект/.test(String(error)),
    );
    const onHead = await createChangeRequest(
      project.id,
      parseDraftInput({
        ...draftBody,
        title: 'on head',
        baseCalculationId: next.id,
        basePackageId: null,
        requirementIds: [],
        proposedChanges: { summary: 'дальше по цепочке' },
      }),
      'ci',
    );
    assert.equal(onHead.baseCalculationId, next.id);

    // 4d. Политика оценки: база изменилась — принять нельзя, reopen сбрасывает оценку.
    await decideChangeRequest(project.id, pair[0].id, asArchitect('defer', 'позже'));
    await prisma.stage.update({ where: { id: s2.id }, data: { hours: 410 } });
    assert.equal(
      (await getChangeRequest(project.id, pair[0].id)).estimateMatchesBase,
      false,
      'estimate is stale after the base changed',
    );
    const reopened = await decideChangeRequest(project.id, pair[0].id, asArchitect('reopen'));
    assert.equal(reopened.status, 'submitted');
    assert.equal(reopened.decidedAt, null);
    assert.equal(reopened.confirmedHours, null, 'stale estimate cleared on reopen');
    await prisma.stage.update({ where: { id: s2.id }, data: { hours: 400 } });

    // 4e. База и результат защищены от удаления (триггеры).
    await rejects('delete base calculation', () =>
      prisma.calculation.delete({ where: { id: calculation.id } }),
    );
    await rejects('delete result calculation', () =>
      prisma.calculation.delete({ where: { id: next.id } }),
    );
    await rejects('delete base package', () =>
      prisma.gostPackage.delete({ where: { id: pkg.id } }),
    );
    // Отказ триггера распознаётся как 409 (restrict_violation).
    const restrict = await prisma.calculation.delete({ where: { id: calculation.id } }).then(
      () => null,
      (error: unknown) => error,
    );
    assert.ok(isChangeRequestRestrictViolation(restrict), `restrict mapped: ${String(restrict)}`);
    // Черновики и отклонённые запросы удаляются вместе с расчётом.
    const spare = await prisma.calculation.create({
      data: {
        templateId: template.id,
        projectId: project.id,
        name: 'spare',
        customer: 'CI',
        answers: '{}',
        version: 99,
      },
    });
    const loose = await prisma.changeRequest.createManyAndReturn({
      data: [
        {
          projectId: project.id,
          seq: 90,
          title: 'draft',
          initiator: 'ci',
          reason: 'ci',
          baseCalculationId: spare.id,
          createdBy: 'ci',
        },
        {
          projectId: project.id,
          seq: 91,
          title: 'rejected',
          initiator: 'ci',
          reason: 'ci',
          status: 'rejected',
          decidedBy: 'ci',
          decidedAt: new Date(),
          baseCalculationId: spare.id,
          createdBy: 'ci',
        },
      ],
    });
    await prisma.calculation.delete({ where: { id: spare.id } });
    assert.equal(
      await prisma.changeRequest.count({ where: { id: { in: loose.map((l) => l.id) } } }),
      0,
      'draft and rejected requests go away with the calculation',
    );
    await deleteDraftChangeRequest(project.id, onHead.id);
    await assert.rejects(deleteDraftChangeRequest(project.id, cr.id), status409);
    await rejects('accepted without result', () =>
      prisma.changeRequest.update({ where: { id: cr.id }, data: { resultCalculationId: null } }),
    );

    // 5. Удаление запроса уносит журнал каскадом.
    await prisma.changeRequest.delete({ where: { id: cr.id } });
    assert.equal(await prisma.changeRequestEvent.count({ where: { crId: cr.id } }), 0);
    // Запросов на базу больше нет — расчёт снова удаляем (триггер пропускает).
  } finally {
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS "ci_fail_risk" ON "Risk"');
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS "ci_fail_risk"()');
    await prisma.changeRequest.deleteMany({ where: { projectId: project.id } });
    await prisma.calculation.deleteMany({ where: { templateId: template.id } });
    await prisma.project.delete({ where: { id: project.id } });
    await prisma.formTemplate.delete({ where: { id: template.id } });
  }
  console.log(
    'Change requests integration passed: base untouched, CHECKs, unique seq, append-only history, cascade, ' +
      'atomic accept with rollback, traceable result, re-estimate policy, delete guard.',
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
