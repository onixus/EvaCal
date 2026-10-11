/**
 * Применение наборов решений и обновления (#103 WP-7b): работа с БД.
 * Чистая логика — `./plan.ts`, `./snapshot.ts`, `./update.ts`; правила —
 * docs/kit-application.md.
 *
 * Меняются только черновики: расчёт в статусе `draft` (иначе — новая версия
 * расчёта по запросу) и черновик комплекта (нет — создаётся из последнего
 * комплекта расчёта). Выпущенные и утверждённые комплекты, утверждённые
 * версии наборов не трогаются. Этапы, риски, снимок и запись применения
 * пишутся одной транзакцией под блокировкой расчёта.
 */
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/lib/generated/prisma/client';
import { safeJsonParse } from '@/lib/json';
import { pmHoursFor, rebuildStagesTx, scheduleConfigFromTemplate } from '@/lib/calc';
import { lockCalculationLedger } from '@/lib/actualsLedgerData';
import {
  createCalculationVersion,
  getOrCreateProject,
  type GostWizardSnapshot,
} from '@/lib/project';
import { primaryInputsFromStageRows } from '@/lib/scheduling';
import { storedContent } from '@/lib/solutionKits/store';
import type { SolutionKitContent } from '@/lib/solutionKits/content';
import { parseOriginRef } from './origin';
import {
  buildApplicationPlan,
  resolveDriverValues,
  type ApplicationPlan,
  type KitSelection,
} from './plan';
import { applyPlanToSnapshot } from './snapshot';
import {
  applySnapshotUpdate,
  buildUpdateProposal,
  collectProjectKitUsage,
  existingStateFor,
  planCalculationUpdate,
  type KitUpdateProposal,
  type ProjectRiskRow,
  type ProjectStageRow,
} from './update';

type Tx = Prisma.TransactionClient;

export type KitAppResult<T> = ({ ok: true } & T) | { ok: false; status: number; error: string };

const fail = (status: number, error: string) => ({ ok: false, status, error }) as const;
const json = (v: unknown) => v as Prisma.InputJsonValue;

// ── Загрузка ────────────────────────────────────────────────────────────

/** Утверждённая версия набора: номер или последняя утверждённая. */
export async function loadApprovedKitVersion(kitId: string, version?: number) {
  const kit = await prisma.solutionKit.findUnique({ where: { id: kitId } });
  if (!kit) return null;
  const row = await prisma.solutionKitVersion.findFirst({
    where: {
      kitId,
      status: 'approved',
      ...(version !== undefined ? { version } : {}),
    },
    orderBy: { version: 'desc' },
  });
  if (!row) return null;
  return { kit, row, content: storedContent(row.content) };
}

const stageSelect = {
  id: true,
  name: true,
  role: true,
  hours: true,
  requirements: true,
  isApprovalTask: true,
  parallel: true,
  approvalDays: true,
  originRef: true,
  order: true,
} as const;

async function loadCalculation(db: Tx | typeof prisma, calculationId: string) {
  return db.calculation.findUnique({
    where: { id: calculationId },
    include: {
      template: {
        select: { fields: true, workDayHours: true, includeWeekends: true, calendarId: true },
      },
      stages: { orderBy: { order: 'asc' }, select: stageSelect },
      risks: {
        orderBy: { order: 'asc' },
        select: { id: true, description: true, hours: true, order: true, originRef: true },
      },
    },
  });
}

/** Комплект, с которым работает расчёт: черновик, иначе последний комплект. */
async function workingPackage(db: Tx | typeof prisma, calculationId: string) {
  const draft = await db.gostPackage.findFirst({
    where: { calculationId, status: 'draft' },
    orderBy: { updatedAt: 'desc' },
  });
  if (draft) return { pkg: draft, isDraft: true };
  const latest = await db.gostPackage.findFirst({
    where: { calculationId },
    orderBy: [{ version: 'desc' }, { updatedAt: 'desc' }],
  });
  return latest ? { pkg: latest, isDraft: false } : null;
}

function parseSnapshot(raw: string | null | undefined): GostWizardSnapshot | null {
  if (!raw) return null;
  const s = safeJsonParse<GostWizardSnapshot | null>(raw, null);
  return s && typeof s === 'object' ? s : null;
}

function answersOf(raw: string): Record<string, unknown> {
  const a = safeJsonParse<Record<string, unknown>>(raw, {});
  return a && typeof a === 'object' ? a : {};
}

/** Черновик комплекта расчёта в транзакции: есть — он, нет — новый. */
async function ensureDraftPackage(
  tx: Tx,
  calc: { id: string; projectId: string | null },
  createdBy: string,
): Promise<{ id: string; snapshot: GostWizardSnapshot | null }> {
  const working = await workingPackage(tx, calc.id);
  if (working?.isDraft)
    return { id: working.pkg.id, snapshot: parseSnapshot(working.pkg.snapshot) };
  const latestInProject = calc.projectId
    ? await tx.gostPackage.findFirst({
        where: { projectId: calc.projectId },
        orderBy: { version: 'desc' },
        select: { version: true },
      })
    : null;
  const nextVersion = (latestInProject?.version ?? 0) + 1;
  const base = working?.pkg;
  const created = await tx.gostPackage.create({
    data: {
      projectId: calc.projectId,
      calculationId: calc.id,
      name: `Черновик комплекта ГОСТ 34 v${nextVersion}`,
      version: nextVersion,
      status: 'draft',
      standardProfileId: base?.standardProfileId ?? 'ru-gost34-current',
      standardProfileVersion: base?.standardProfileVersion ?? '2020',
      generatorVersion: base?.generatorVersion ?? '0.3.0',
      documentTypes: base?.documentTypes ?? JSON.stringify(['tz']),
      snapshot: base?.snapshot ?? null,
      createdBy,
    },
  });
  return { id: created.id, snapshot: parseSnapshot(base?.snapshot) };
}

async function ensureProject(calc: {
  id: string;
  projectId: string | null;
  name: string;
  customer: string;
  createdBy: string;
}) {
  if (calc.projectId) return calc.projectId;
  const project = await getOrCreateProject({
    name: calc.name,
    customer: calc.customer,
    createdBy: calc.createdBy,
  });
  await prisma.calculation.update({ where: { id: calc.id }, data: { projectId: project.id } });
  return project.id;
}

function toStageRows(stages: ProjectStageRow[]): ProjectStageRow[] {
  return stages;
}

// ── Предпросмотр и применение ─────────────────────────────────────────

/**
 * План без записи: что будет создано, что пропущено и почему, значения
 * драйверов по умолчанию. Тот же план строит применение.
 */
export async function previewKitApplication(input: {
  calculationId: string;
  kitId: string;
  version?: number;
  selection: KitSelection;
}): Promise<
  KitAppResult<{
    plan: ApplicationPlan;
    kit: { id: string; key: string; name: string; version: number };
    content: SolutionKitContent;
  }>
> {
  const loaded = await loadApprovedKitVersion(input.kitId, input.version);
  if (!loaded) return fail(404, 'Утверждённая версия набора не найдена');
  const calc = await loadCalculation(prisma, input.calculationId);
  if (!calc) return fail(404, 'Расчёт не найден');
  const working = await workingPackage(prisma, calc.id);
  const snapshot = parseSnapshot(working?.pkg.snapshot);
  const usage = collectProjectKitUsage(toStageRows(calc.stages), calc.risks, snapshot);
  const plan = buildApplicationPlan({
    kit: { id: loaded.kit.id, key: loaded.kit.key },
    version: { version: loaded.row.version, content: loaded.content },
    selection: input.selection,
    answers: answersOf(calc.answers),
    existing: existingStateFor(usage.get(loaded.kit.id), snapshot),
  });
  return {
    ok: true,
    plan,
    kit: {
      id: loaded.kit.id,
      key: loaded.kit.key,
      name: loaded.kit.name,
      version: loaded.row.version,
    },
    content: loaded.content,
  };
}

export interface KitAppActor {
  username: string;
}

/**
 * Применение утверждённой версии набора к расчёту и/или черновику комплекта.
 * Расчёт не в черновике — 409, либо (`createVersion`) новая черновая версия
 * расчёта, к которой и применяется набор.
 */
export async function applyKit(
  actor: KitAppActor,
  input: {
    calculationId: string;
    kitId: string;
    version?: number;
    selection: KitSelection;
    createVersion?: boolean;
  },
): Promise<
  KitAppResult<{ applicationId: string; calculationId: string; packageId: string | null }>
> {
  const loaded = await loadApprovedKitVersion(input.kitId, input.version);
  if (!loaded) return fail(404, 'Утверждённая версия набора не найдена');
  if (loaded.kit.status === 'archived') return fail(409, 'Набор в архиве');
  const calc = await loadCalculation(prisma, input.calculationId);
  if (!calc) return fail(404, 'Расчёт не найден');
  const needsVersion = calc.status !== 'draft';
  if (needsVersion && !input.createVersion) {
    return fail(
      409,
      'Расчёт не черновик: создайте новую версию (createVersion) или выберите черновик',
    );
  }
  // Проект нужен комплекту; новая версия расчёта заводит его сама.
  const projectIdBefore =
    input.selection.targets.package && !needsVersion ? await ensureProject(calc) : calc.projectId;
  const config = await scheduleConfigFromTemplate(calc.template);
  const kitRef = { id: loaded.kit.id, key: loaded.kit.key };

  const result = await prisma.$transaction(
    async (tx) => {
      let targetId = calc.id;
      let projectId = projectIdBefore;
      if (needsVersion) {
        // Новая черновая версия — в той же транзакции, что и применение.
        const created = await createCalculationVersion(
          {
            parentCalculationId: calc.id,
            createdBy: actor.username,
            versionComment: `Применение набора ${loaded.kit.key} v${loaded.row.version}`,
          },
          tx,
        );
        if (!created) return fail(404, 'Расчёт не найден');
        targetId = created.id;
        projectId = created.projectId;
        // Базой черновика комплекта новой версии служит комплект исходного расчёта.
        const source = await workingPackage(tx, calc.id);
        if (input.selection.targets.package && source) {
          const latest = await tx.gostPackage.findFirst({
            where: { projectId },
            orderBy: { version: 'desc' },
            select: { version: true },
          });
          await tx.gostPackage.create({
            data: {
              projectId,
              calculationId: created.id,
              name: `Черновик комплекта ГОСТ 34 (из v${source.pkg.version})`,
              version: (latest?.version ?? 0) + 1,
              status: 'draft',
              standardProfileId: source.pkg.standardProfileId,
              standardProfileVersion: source.pkg.standardProfileVersion,
              generatorVersion: source.pkg.generatorVersion,
              documentTypes: source.pkg.documentTypes,
              snapshot: remapSnapshotStages(source.pkg.snapshot, created.stages, calc.stages),
              createdBy: actor.username,
            },
          });
        }
      }
      await lockCalculationLedger(tx, targetId);
      // Перечитываем под блокировкой: план строится по актуальному состоянию.
      const fresh = await loadCalculation(tx, targetId);
      if (!fresh) return fail(404, 'Расчёт не найден');
      if (fresh.status !== 'draft') return fail(409, 'Расчёт перестал быть черновиком');
      const answers = answersOf(fresh.answers);
      const pkg = input.selection.targets.package
        ? await ensureDraftPackage(tx, { id: fresh.id, projectId }, actor.username)
        : null;
      const snapshot = pkg
        ? pkg.snapshot
        : parseSnapshot((await workingPackage(tx, fresh.id))?.pkg.snapshot);
      const usage = collectProjectKitUsage(toStageRows(fresh.stages), fresh.risks, snapshot);
      const existing = existingStateFor(usage.get(kitRef.id), snapshot);
      const plan = buildApplicationPlan({
        kit: kitRef,
        version: { version: loaded.row.version, content: loaded.content },
        selection: input.selection,
        answers,
        existing,
      });

      // Этапы: прежние строки (с их originRef) + новые из набора, перестройка на месте.
      let stageIdByElement = new Map(existing.stageIdByElement);
      if (plan.stages.length > 0) {
        const primary = [
          ...primaryInputsFromStageRows(fresh.stages),
          ...plan.stages.map((s) => ({
            name: s.name,
            role: s.role,
            hours: s.hours,
            requirements: s.requirements,
            originRef: s.originRef,
          })),
        ];
        await tx.calculation.update({
          where: { id: fresh.id },
          data: { pmHours: pmHoursFor(fresh.template.fields, answers, primary) },
        });
        await rebuildStagesTx(tx, fresh.id, primary, fresh.startDate, config);
        stageIdByElement = await kitStageIds(tx, fresh.id, kitRef.id);
      }

      const riskIds: Record<string, string> = {};
      let order = fresh.risks.reduce((m, r) => Math.max(m, r.order), -1);
      for (const r of plan.risks) {
        const row = await tx.risk.create({
          data: {
            calculationId: fresh.id,
            description: r.description,
            hours: r.hours,
            order: ++order,
            originRef: r.originRef,
          },
          select: { id: true },
        });
        riskIds[r.elementId] = row.id;
      }

      let links: { requirementId: string; stageId: string }[] = [];
      if (pkg) {
        const applied = applyPlanToSnapshot(
          pkg.snapshot,
          plan,
          stageIdByElement,
          existing.requirementIdByElement,
        );
        links = applied.links;
        await tx.gostPackage.update({
          where: { id: pkg.id },
          data: { snapshot: JSON.stringify(applied.snapshot) },
        });
      }

      const mapping = {
        stages: Object.fromEntries(
          plan.stages.map((s) => [s.elementId, stageIdByElement.get(s.elementId) ?? null]),
        ),
        risks: riskIds,
        requirements: Object.fromEntries(plan.requirements.map((r) => [r.origin.elementId, r.id])),
        checks: Object.fromEntries(plan.checks.map((c) => [c.origin.elementId, c.requirementIds])),
        fragments: Object.fromEntries(
          plan.fragments.map((f) => [f.origin.elementId, f.sectionKey]),
        ),
        links,
        skipped: plan.skipped,
        driverValues: plan.driverValues,
      };
      const app = await tx.kitApplication.create({
        data: {
          kind: 'apply',
          kitId: kitRef.id,
          kitVersionId: loaded.row.id,
          calculationId: fresh.id,
          packageId: pkg?.id ?? null,
          selection: json(input.selection),
          mapping: json(mapping),
          appliedBy: actor.username,
        },
        select: { id: true },
      });
      return {
        ok: true as const,
        applicationId: app.id,
        calculationId: fresh.id,
        packageId: pkg?.id ?? null,
      };
    },
    { timeout: 60_000 },
  );
  return result;
}

/** elementId этапов набора → Stage.id по originRef строк расчёта. */
async function kitStageIds(tx: Tx, calculationId: string, kitId: string) {
  const rows = await tx.stage.findMany({
    where: { calculationId, isApprovalTask: false, originRef: { startsWith: `kit:${kitId}@` } },
    orderBy: { order: 'asc' },
    select: { id: true, originRef: true },
  });
  const map = new Map<string, string>();
  for (const r of rows) {
    const o = parseOriginRef(r.originRef);
    if (o && !map.has(o.elementId)) map.set(o.elementId, r.id);
  }
  return map;
}

/**
 * Снимок комплекта для новой версии расчёта: ручные связи переводятся со
 * строк этапов исходного расчёта на их копии (версия копирует этапы в том же
 * порядке).
 */
function remapSnapshotStages(
  raw: string | null,
  newStages: { id: string; order: number }[],
  sourceStages: { id: string; order: number }[],
): string | null {
  const snapshot = parseSnapshot(raw);
  if (!snapshot) return raw;
  const byOrder = new Map(newStages.map((s) => [s.order, s.id]));
  const map = new Map(sourceStages.map((s) => [s.id, byOrder.get(s.order)]));
  snapshot.manualLinks = (snapshot.manualLinks ?? []).map((l) => {
    const link = l as { targetId?: string };
    const next = link.targetId ? map.get(link.targetId) : undefined;
    return next ? { ...link, targetId: next } : l;
  });
  return JSON.stringify(snapshot);
}

// ── Использование и обновления ─────────────────────────────────────────

export async function listKitApplications(calculationId: string) {
  return prisma.kitApplication.findMany({
    where: { calculationId },
    orderBy: { appliedAt: 'desc' },
    include: {
      kitVersion: {
        select: { version: true, kit: { select: { id: true, key: true, name: true } } },
      },
      fromVersion: { select: { version: true } },
    },
  });
}

/**
 * Предложения обновлений: по каждому набору, элементы которого есть в
 * расчёте или его комплекте, — сравнение с последней утверждённой версией.
 */
export async function kitUpdateProposals(
  calculationId: string,
  explicitDrivers: Record<string, number> = {},
): Promise<KitAppResult<{ proposals: (KitUpdateProposal & { kitName: string })[] }>> {
  const calc = await loadCalculation(prisma, calculationId);
  if (!calc) return fail(404, 'Расчёт не найден');
  const working = await workingPackage(prisma, calc.id);
  const snapshot = parseSnapshot(working?.pkg.snapshot);
  const usage = collectProjectKitUsage(toStageRows(calc.stages), calc.risks, snapshot);
  const proposals: (KitUpdateProposal & { kitName: string })[] = [];
  for (const u of usage.values()) {
    const p = await proposalFor(u, calc.answers, snapshot !== null, explicitDrivers);
    if (p && p.changes.length > 0) proposals.push(p);
  }
  return { ok: true, proposals };
}

async function proposalFor(
  usage: ReturnType<typeof collectProjectKitUsage> extends Map<string, infer U> ? U : never,
  answersRaw: string,
  hasPackage: boolean,
  explicitDrivers: Record<string, number>,
) {
  const latest = await loadApprovedKitVersion(usage.kitId);
  if (!latest) return null;
  if (usage.versions.every((v) => v >= latest.row.version)) return null;
  const rows = await prisma.solutionKitVersion.findMany({
    where: { kitId: usage.kitId, version: { in: usage.versions } },
  });
  const versions = new Map(rows.map((r) => [r.version, storedContent(r.content)]));
  const driverValues = resolveDriverValues(latest.content, answersOf(answersRaw), explicitDrivers);
  return {
    ...buildUpdateProposal({
      kit: { id: latest.kit.id, key: latest.kit.key },
      to: { version: latest.row.version, content: latest.content },
      versions,
      usage,
      driverValues,
      hasPackage,
    }),
    kitName: latest.kit.name,
  };
}

/**
 * Перенос выбранных изменений последней утверждённой версии набора в НОВУЮ
 * черновую версию расчёта (и черновик комплекта при нём). Исходный расчёт и
 * его комплекты не меняются.
 */
export async function applyKitUpdate(
  actor: KitAppActor,
  input: {
    calculationId: string;
    kitId: string;
    toVersion: number;
    elementIds: string[];
    driverValues?: Record<string, number>;
  },
): Promise<
  KitAppResult<{ applicationId: string; calculationId: string; packageId: string | null }>
> {
  const source = await loadCalculation(prisma, input.calculationId);
  if (!source) return fail(404, 'Расчёт не найден');
  const sourcePkg = await workingPackage(prisma, source.id);
  const sourceSnapshot = parseSnapshot(sourcePkg?.pkg.snapshot);
  const usage = collectProjectKitUsage(
    toStageRows(source.stages),
    source.risks,
    sourceSnapshot,
  ).get(input.kitId);
  if (!usage) return fail(404, 'Набор в проекте не используется');
  const proposal = await proposalFor(
    usage,
    source.answers,
    sourceSnapshot !== null,
    input.driverValues ?? {},
  );
  if (!proposal) return fail(409, 'Новой утверждённой версии набора нет');
  if (proposal.toVersion !== input.toVersion) {
    return fail(
      409,
      `Последняя утверждённая версия — v${proposal.toVersion}: обновите предложение`,
    );
  }
  const known = new Set(proposal.changes.map((c) => c.elementId));
  const selected = new Set(input.elementIds);
  if (selected.size === 0) return fail(400, 'Не выбрано ни одного изменения');
  for (const id of selected) {
    if (!known.has(id)) return fail(400, `Изменение «${id}» отсутствует в предложении`);
  }
  const to = await loadApprovedKitVersion(input.kitId, input.toVersion);
  if (!to) return fail(404, 'Версия набора не найдена');
  const fromRow = await prisma.solutionKitVersion.findUnique({
    where: { kitId_version: { kitId: input.kitId, version: Math.max(...usage.versions) } },
    select: { id: true },
  });
  if (!fromRow) return fail(409, 'Исходная версия набора не найдена');

  const config = await scheduleConfigFromTemplate(source.template);
  const kitRef = { id: to.kit.id, key: to.kit.key };

  return prisma.$transaction(
    async (tx) => {
      // Новая версия расчёта — в той же транзакции, что и перенос изменений.
      const created = await createCalculationVersion(
        {
          parentCalculationId: source.id,
          createdBy: actor.username,
          versionComment: `Обновление набора ${to.kit.key} до v${to.row.version}`,
        },
        tx,
      );
      if (!created) return fail(404, 'Расчёт не найден');
      const projectId = created.projectId;
      await lockCalculationLedger(tx, created.id);
      const calc = await loadCalculation(tx, created.id);
      if (!calc) return fail(404, 'Расчёт не найден');
      const answers = answersOf(calc.answers);
      const driverValues = resolveDriverValues(to.content, answers, input.driverValues ?? {});
      const remapped = sourcePkg
        ? parseSnapshot(remapSnapshotStages(sourcePkg.pkg.snapshot, calc.stages, source.stages))
        : null;
      const newUsage = collectProjectKitUsage(toStageRows(calc.stages), calc.risks, remapped).get(
        kitRef.id,
      )!;
      const calcPlan = planCalculationUpdate({
        kit: kitRef,
        to: { version: to.row.version, content: to.content },
        proposal,
        selected,
        usage: newUsage,
        stages: toStageRows(calc.stages),
        risks: calc.risks as ProjectRiskRow[],
        snapshot: remapped,
        driverValues,
        hasPackage: remapped !== null,
      });
      await tx.calculation.update({
        where: { id: calc.id },
        data: { pmHours: pmHoursFor(calc.template.fields, answers, calcPlan.primary) },
      });
      await rebuildStagesTx(tx, calc.id, calcPlan.primary, calc.startDate, config);
      for (const r of calcPlan.riskUpdates) {
        await tx.risk.update({
          where: { id: r.id },
          data: { description: r.description, hours: r.hours, originRef: r.originRef },
        });
      }
      for (const r of calcPlan.riskOriginBumps) {
        await tx.risk.update({ where: { id: r.id }, data: { originRef: r.originRef } });
      }
      if (calcPlan.riskDeletes.length > 0) {
        await tx.risk.deleteMany({ where: { id: { in: calcPlan.riskDeletes } } });
      }
      let order = calc.risks.reduce((m, r) => Math.max(m, r.order), -1);
      for (const r of calcPlan.addPlan.risks) {
        await tx.risk.create({
          data: {
            calculationId: calc.id,
            description: r.description,
            hours: r.hours,
            order: ++order,
            originRef: r.originRef,
          },
        });
      }

      let packageId: string | null = null;
      if (remapped && sourcePkg) {
        const stageIdByElement = await kitStageIds(tx, calc.id, kitRef.id);
        const snapshot = applySnapshotUpdate({
          kit: kitRef,
          to: { version: to.row.version, content: to.content },
          proposal,
          selected,
          snapshot: remapped,
          addPlan: calcPlan.addPlan,
          stageIdByElement,
        });
        const latest = await tx.gostPackage.findFirst({
          where: { projectId },
          orderBy: { version: 'desc' },
          select: { version: true },
        });
        const nextVersion = (latest?.version ?? 0) + 1;
        const pkg = await tx.gostPackage.create({
          data: {
            projectId,
            calculationId: calc.id,
            name: `Черновик комплекта ГОСТ 34 v${nextVersion} (набор ${kitRef.key} v${to.row.version})`,
            version: nextVersion,
            status: 'draft',
            standardProfileId: sourcePkg.pkg.standardProfileId,
            standardProfileVersion: sourcePkg.pkg.standardProfileVersion,
            generatorVersion: sourcePkg.pkg.generatorVersion,
            documentTypes: sourcePkg.pkg.documentTypes,
            snapshot: JSON.stringify(snapshot),
            createdBy: actor.username,
          },
          select: { id: true },
        });
        packageId = pkg.id;
      }

      const app = await tx.kitApplication.create({
        data: {
          kind: 'update',
          kitId: kitRef.id,
          kitVersionId: to.row.id,
          fromVersionId: fromRow.id,
          calculationId: calc.id,
          packageId,
          selection: json({ elementIds: [...selected].sort(), driverValues }),
          mapping: json({
            sourceCalculationId: source.id,
            sourcePackageId: sourcePkg?.pkg.id ?? null,
            changes: proposal.changes
              .filter((c) => selected.has(c.elementId))
              .map((c) => ({ elementId: c.elementId, section: c.section, kind: c.kind })),
            carriedUnchanged: proposal.unchanged,
          }),
          appliedBy: actor.username,
        },
        select: { id: true },
      });
      return { ok: true as const, applicationId: app.id, calculationId: calc.id, packageId };
    },
    { timeout: 60_000 },
  );
}
