/** Применение наборов решений и предложения обновлений (#103 WP-7b) на живой
 * PostgreSQL: провенанс этапов, рисков и требований, сохранение ссылок,
 * воспроизводимость, originRef переживает перестройку этапов, только черновики
 * (утверждённый расчёт — 409 или новая версия, выпущенный комплект не
 * меняется), триггер KitApplication, обновление — только выбранные изменения
 * и только в новую версию расчёта.
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { rebuildStages } from '../lib/calc';
import { primaryInputsFromStageRows } from '../lib/scheduling';
import {
  approveVersion,
  createDraftVersion,
  createKit,
  getKitVersion,
  updateDraftVersion,
} from '../lib/solutionKits/store';
import { applyKit, applyKitUpdate, kitUpdateProposals } from '../lib/kitApplication/store';
import type { KitSelection } from '../lib/kitApplication/plan';

async function rejects(label: string, fn: () => Promise<unknown>, pattern: RegExp) {
  try {
    await fn();
  } catch (e) {
    assert.match(String((e as Error).message ?? e), pattern, label);
    return;
  }
  assert.fail(`${label}: ожидался отказ СУБД`);
}

const kitContent = {
  fields: [
    { elementId: 'field-sites', key: 'sites', label: 'Площадки', type: 'number', required: true },
  ],
  requirements: [
    {
      elementId: 'req-1',
      code: 'ТР-1',
      category: 'functional',
      title: 'Сбор журналов',
      description: 'Система должна собирать журналы событий.',
      criterion: 'Журналы поступают',
    },
    {
      elementId: 'req-2',
      category: 'security',
      title: 'Шифрование',
      description: 'Система должна шифровать каналы.',
    },
  ],
  stages: [
    {
      elementId: 'stage-01',
      name: 'Монтаж',
      role: 'engineer',
      baseHours: 8,
      hoursPerUnit: 4,
      driver: 'field-sites',
      notes: 'Площадки заказчика',
      requirementIds: ['req-1'],
    },
    { elementId: 'stage-02', name: 'Обучение', role: 'consultant', baseHours: 6 },
  ],
  risks: [{ elementId: 'risk-01', description: 'Задержка доступа', hours: 8 }],
  checks: [
    {
      elementId: 'chk-1',
      requirementIds: ['req-1'],
      criteria: 'Журналы в консоли',
      method: 'TEST',
    },
    { elementId: 'chk-2', requirementIds: ['req-2'], criteria: 'TLS 1.3' },
  ],
  fragments: [
    { elementId: 'frag-1', sectionKey: 'scope', title: 'Область', text: 'Абзац 1\nАбзац 2' },
  ],
};

async function newCalculation(templateId: string, label: string) {
  const project = await prisma.project.create({ data: { name: `kits-${label}`, customer: 'CI' } });
  return prisma.calculation.create({
    data: {
      templateId,
      projectId: project.id,
      name: `Расчёт ${label}`,
      customer: 'CI',
      answers: JSON.stringify({ sites: 3 }),
      status: 'draft',
      stages: {
        create: [
          {
            name: 'Ручной этап',
            role: 'pm',
            hours: 5,
            order: 0,
            startDate: new Date('2026-03-02'),
            endDate: new Date('2026-03-02'),
          },
        ],
      },
    },
  });
}

async function draftSnapshot(calculationId: string) {
  const pkg = await prisma.gostPackage.findFirst({
    where: { calculationId, status: 'draft' },
    orderBy: { updatedAt: 'desc' },
  });
  return { pkg, snapshot: pkg?.snapshot ? JSON.parse(pkg.snapshot) : null };
}

/** Результат применения без id строк — для сравнения воспроизводимости. */
async function shape(calculationId: string) {
  const stages = await prisma.stage.findMany({
    where: { calculationId },
    orderBy: { order: 'asc' },
    select: { name: true, role: true, hours: true, requirements: true, originRef: true },
  });
  const risks = await prisma.risk.findMany({
    where: { calculationId },
    orderBy: { order: 'asc' },
    select: { description: true, hours: true, originRef: true },
  });
  const { snapshot } = await draftSnapshot(calculationId);
  const stageNames = new Map(
    (await prisma.stage.findMany({ where: { calculationId } })).map((s) => [s.id, s.name]),
  );
  return {
    stages,
    risks,
    requirements: snapshot?.requirements,
    kitChecks: snapshot?.kitChecks,
    sectionOverrides: snapshot?.sectionOverrides,
    links: (snapshot?.manualLinks ?? []).map((l: { sourceId: string; targetId: string }) => [
      l.sourceId,
      stageNames.get(l.targetId),
    ]),
  };
}

async function main() {
  const actorUser = await prisma.user.create({
    data: { username: `kit-arch-${randomUUID()}`, role: 'architect', passwordHash: 'x' },
  });
  const actor = { userId: actorUser.id, role: 'architect', username: actorUser.username };
  const template = await prisma.formTemplate.create({
    data: {
      name: `kits-${randomUUID()}`,
      fields: { create: [{ label: 'Площадки', key: 'sites', type: 'number' }] },
    },
  });

  // ── Набор v1 ──────────────────────────────────────────────────────────
  const created = await createKit(actor, {
    key: `ci.kit-${randomUUID().slice(0, 8)}`,
    name: 'CI: применение',
    content: kitContent,
  });
  assert.ok(created.ok, 'набор создан');
  const kitId = created.kit.id;
  const seen = async (v: number) =>
    (
      await prisma.solutionKitVersion.findUniqueOrThrow({
        where: { kitId_version: { kitId, version: v } },
      })
    ).updatedAt;
  assert.ok((await approveVersion(actor, kitId, 1, await seen(1))).ok, 'v1 утверждена');

  // ── Применение с адаптацией ────────────────────────────────────────────
  const selection: KitSelection = {
    targets: { calculation: true, package: true },
    excluded: ['stage-02'],
    overrides: { 'risk-01': { hours: 5 } },
    driverValues: {},
  };
  const calcA = await newCalculation(template.id, 'A');
  const applied = await applyKit(actor, { calculationId: calcA.id, kitId, selection });
  assert.ok(applied.ok, `применение: ${!applied.ok ? applied.error : ''}`);
  const a = await shape(calcA.id);
  const monta = a.stages.find((s) => s.name === 'Монтаж')!;
  assert.equal(monta.hours, 8 + 4 * 3, 'часы по драйверу из ответов расчёта');
  assert.equal(monta.originRef, `kit:${kitId}@1#stage-01`);
  assert.equal(a.stages.find((s) => s.name === 'Ручной этап')!.originRef, null);
  assert.ok(!a.stages.some((s) => s.name === 'Обучение'), 'исключённый этап не применён');
  assert.deepEqual(a.risks, [
    { description: 'Задержка доступа', hours: 5, originRef: `kit:${kitId}@1#risk-01` },
  ]);
  const req1 = a.requirements.find(
    (r: { origin?: { elementId: string } }) => r.origin?.elementId === 'req-1',
  );
  assert.equal(req1.origin.kitId, kitId);
  assert.equal(req1.origin.kitVersion, 1);
  assert.deepEqual(req1.acceptanceCriteria, ['Журналы поступают', 'Журналы в консоли']);
  assert.equal(req1.verificationMethod, 'TEST');
  assert.deepEqual(a.links, [[req1.id, 'Монтаж']], 'связь требование → этап сохранена');
  assert.deepEqual(a.sectionOverrides.scope, {
    title: 'Область',
    paragraphs: ['Абзац 1', 'Абзац 2'],
  });
  const app = await prisma.kitApplication.findUniqueOrThrow({
    where: { id: applied.applicationId },
  });
  assert.equal(app.kind, 'apply');
  assert.ok((app.mapping as { stages: Record<string, string> }).stages['stage-01']);
  console.log('[kit-app] применение: провенанс, драйверы, критерии, связи, фрагменты');

  // ── Воспроизводимость ─────────────────────────────────────────────────
  const calcB = await newCalculation(template.id, 'B');
  assert.ok((await applyKit(actor, { calculationId: calcB.id, kitId, selection })).ok);
  const b = await shape(calcB.id);
  assert.deepEqual(b, a, 'та же версия и адаптация — тот же результат');
  const again = await applyKit(actor, { calculationId: calcA.id, kitId, selection });
  assert.ok(again.ok);
  assert.deepEqual(await shape(calcA.id), a, 'повторное применение ничего не дублирует');
  console.log('[kit-app] воспроизводимо и идемпотентно');

  // ── originRef переживает перестройку этапов (правка в редакторе) ───────
  const rows = await prisma.stage.findMany({
    where: { calculationId: calcA.id },
    orderBy: { order: 'asc' },
  });
  const edited = primaryInputsFromStageRows(rows).map((p) => {
    const { originRef: _drop, ...rest } = p; // редактор этапов originRef не присылает
    void _drop;
    return p.name === 'Монтаж' ? { ...rest, name: 'Монтаж оборудования', hours: 30 } : rest;
  });
  await rebuildStages(calcA.id, edited, calcA.startDate);
  const renamed = await prisma.stage.findFirstOrThrow({
    where: { calculationId: calcA.id, name: 'Монтаж оборудования' },
  });
  assert.equal(renamed.originRef, `kit:${kitId}@1#stage-01`, 'originRef сохранился');
  console.log('[kit-app] originRef переживает rebuildStages');

  // ── Только черновики ──────────────────────────────────────────────────
  const calcC = await newCalculation(template.id, 'C');
  const released = await prisma.gostPackage.create({
    data: {
      projectId: calcC.projectId,
      calculationId: calcC.id,
      name: 'Выпущенный',
      version: 1,
      status: 'approved',
      standardProfileId: 'ru-gost34-current',
      standardProfileVersion: '2020',
      generatorVersion: '0.3.0',
      documentTypes: '["tz"]',
      snapshot: JSON.stringify({ requirements: [] }),
    },
  });
  await prisma.calculation.update({ where: { id: calcC.id }, data: { status: 'approved' } });
  const refused = await applyKit(actor, { calculationId: calcC.id, kitId, selection });
  assert.ok(!refused.ok && refused.status === 409, 'утверждённый расчёт — 409');
  const viaVersion = await applyKit(actor, {
    calculationId: calcC.id,
    kitId,
    selection,
    createVersion: true,
  });
  assert.ok(viaVersion.ok && viaVersion.calculationId !== calcC.id, 'новая версия расчёта');
  assert.equal(
    await prisma.stage.count({ where: { calculationId: calcC.id, originRef: { not: null } } }),
    0,
    'утверждённый расчёт не изменён',
  );
  const releasedAfter = await prisma.gostPackage.findUniqueOrThrow({ where: { id: released.id } });
  assert.equal(releasedAfter.snapshot, released.snapshot, 'выпущенный комплект не изменён');
  assert.equal(releasedAfter.status, 'approved');
  console.log('[kit-app] применяется только к черновикам');

  // ── Триггер KitApplication ─────────────────────────────────────────────
  await rejects(
    'триггер: запись неизменна',
    () => prisma.kitApplication.update({ where: { id: app.id }, data: { appliedBy: 'x' } }),
    /immutable/,
  );
  const draft = await createDraftVersion(actor, kitId);
  assert.ok(draft.ok);
  await rejects(
    'триггер: черновик набора не применяется',
    () =>
      prisma.kitApplication.create({
        data: {
          kitId,
          kitVersionId: draft.version.id,
          calculationId: calcA.id,
          selection: {},
          mapping: {},
          appliedBy: 'ci',
        },
      }),
    /not approved/,
  );

  // ── v2 и предложение обновления ───────────────────────────────────────
  const v2 = await getKitVersion(kitId, 2);
  const next = structuredClone(v2!.content);
  next.stages[0].baseHours = 10; // stage-01 изменён в наборе
  next.requirements[0].title = 'Сбор и хранение журналов';
  next.risks = []; // risk-01 удалён
  next.stages.push({
    elementId: 'stage-03',
    name: 'Настройка шифрования',
    role: 'engineer',
    baseHours: 4,
    hoursPerUnit: 0,
    driver: null,
    notes: null,
    requirementIds: ['req-2'],
  });
  next.checks.push({
    elementId: 'chk-3',
    requirementIds: ['req-1'],
    criteria: 'Хранение 90 дней',
    method: null,
  });
  assert.ok((await updateDraftVersion(actor, kitId, 2, { content: next, changelog: 'v2' })).ok);
  assert.ok((await approveVersion(actor, kitId, 2, await seen(2))).ok, 'v2 утверждена');

  const props = await kitUpdateProposals(calcA.id);
  assert.ok(props.ok);
  const proposal = props.proposals.find((p) => p.kitId === kitId)!;
  assert.equal(proposal.toVersion, 2);
  const kinds = Object.fromEntries(proposal.changes.map((c) => [c.elementId, c.kind]));
  assert.equal(kinds['stage-01'], 'changed');
  assert.equal(kinds['req-1'], 'changed');
  assert.equal(kinds['risk-01'], 'removed');
  assert.equal(kinds['stage-03'], 'added');
  assert.equal(kinds['chk-3'], 'added');
  assert.equal(kinds['stage-02'], undefined, 'исключённый при адаптации снова не предлагается');
  const stageChange = proposal.changes.find((c) => c.elementId === 'stage-01')!;
  assert.ok(
    stageChange.fields.includes('name'),
    'разница с адаптированным проектом (переименован)',
  );
  assert.equal(stageChange.kitChanged, true);

  const before = await shape(calcA.id);
  const upd = await applyKitUpdate(actor, {
    calculationId: calcA.id,
    kitId,
    toVersion: 2,
    elementIds: ['stage-01', 'stage-03', 'req-1'],
  });
  assert.ok(upd.ok, `обновление: ${!upd.ok ? upd.error : ''}`);
  assert.notEqual(upd.calculationId, calcA.id, 'обновление — в новую версию расчёта');
  assert.deepEqual(await shape(calcA.id), before, 'исходная версия не изменена');
  const u = await shape(upd.calculationId);
  const s1 = u.stages.find((s) => s.originRef === `kit:${kitId}@2#stage-01`)!;
  assert.equal(s1.name, 'Монтаж');
  assert.equal(s1.hours, 10 + 4 * 3);
  assert.ok(
    u.stages.some((s) => s.originRef === `kit:${kitId}@2#stage-03`),
    'stage-03 добавлен',
  );
  assert.deepEqual(
    u.risks.map((r) => r.originRef),
    [`kit:${kitId}@1#risk-01`],
    'невыбранное удаление не применено',
  );
  const r1 = u.requirements.find(
    (r: { origin?: { elementId: string } }) => r.origin?.elementId === 'req-1',
  );
  assert.equal(r1.title, 'Сбор и хранение журналов');
  assert.equal(r1.origin.kitVersion, 2);
  const r2 = u.requirements.find(
    (r: { origin?: { elementId: string } }) => r.origin?.elementId === 'req-2',
  );
  assert.ok(
    u.links.some((l: [string, string]) => l[0] === r2.id && l[1] === 'Настройка шифрования'),
    'связь req-2 → stage-03 создана',
  );
  assert.ok(
    u.links.some((l: [string, string]) => l[0] === r1.id && l[1] === 'Монтаж'),
    'связь req-1 → stage-01 переведена на новую версию расчёта',
  );
  const updApp = await prisma.kitApplication.findUniqueOrThrow({
    where: { id: upd.applicationId },
  });
  assert.equal(updApp.kind, 'update');
  assert.ok(updApp.fromVersionId);

  const rest = await kitUpdateProposals(upd.calculationId);
  assert.ok(rest.ok);
  const left = rest.proposals.find((p) => p.kitId === kitId)!;
  const leftIds = left.changes.map((c) => c.elementId).sort();
  assert.deepEqual(leftIds, ['chk-3', 'risk-01'], 'невыбранные изменения предлагаются снова');
  console.log('[kit-app] обновление: только выбранное и только в новую версию');
}

main()
  .then(() => console.log('[kit-app] OK'))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
