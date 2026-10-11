/**
 * Применение наборов решений и обновления (#103 WP-7b): работа с БД.
 * Чистая логика — `./plan.ts`, `./snapshot.ts`, `./update.ts`; правила —
 * docs/kit-application.md.
 *
 * Меняются только черновики: расчёт в статусе `draft` (иначе — новая версия
 * расчёта по запросу) и черновик комплекта (нет — новая черновая версия
 * комплекта из последнего комплекта расчёта). Выпущенные и утверждённые
 * комплекты, утверждённые версии наборов не трогаются.
 *
 * Всё пишется одной транзакцией: блокировка расчёта (журнал факта, та же, что
 * у перестройки этапов) и `SELECT … FOR UPDATE` строк расчёта и черновика
 * комплекта; запись снимка — условная (`status = 'draft'` и прежний
 * `updatedAt`), иначе 409. Номера версий комплекта берутся под блокировкой
 * проекта (`createDraftPackageVersion`). Пустой план — ответ без записи.
 */
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/lib/generated/prisma/client';
import { safeJsonParse } from '@/lib/json';
import { pmHoursFor, rebuildStagesTx, scheduleConfigFromTemplate } from '@/lib/calc';
import { lockCalculationLedger } from '@/lib/actualsLedgerData';
import {
  createCalculationVersion,
  createDraftPackageVersion,
  type GostWizardSnapshot,
} from '@/lib/project';
import { applyProposedChanges, matchStageIds } from '@/lib/changeRequests/apply';
import { primaryInputsFromStageRows } from '@/lib/scheduling';
import { storedContent } from '@/lib/solutionKits/store';
import type { SolutionKitContent } from '@/lib/solutionKits/content';
import { parseOriginRef } from './origin';
import {
  buildApplicationPlan,
  isEmptyPlan,
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
  type ProjectKitUsage,
  type ProjectRiskRow,
  type ProjectStageRow,
} from './update';

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

export type KitAppResult<T> = ({ ok: true } & T) | { ok: false; status: number; error: string };

export interface KitAppOutcome {
  /** null — план пуст, ничего не записано. */
  applicationId: string | null;
  calculationId: string;
  packageId: string | null;
  noop: boolean;
}

const fail = (status: number, error: string) => ({ ok: false, status, error }) as const;
const json = (v: unknown) => v as Prisma.InputJsonValue;

/** Конфликт внутри транзакции: откатывает её, наружу — 409. */
class KitConflict extends Error {}

// ── Загрузка ────────────────────────────────────────────────────────────

/** Утверждённая версия набора: номер или последняя утверждённая. */
export async function loadApprovedKitVersion(kitId: string, version?: number, db: Db = prisma) {
  const kit = await db.solutionKit.findUnique({ where: { id: kitId } });
  if (!kit) return null;
  const row = await db.solutionKitVersion.findFirst({
    where: { kitId, status: 'approved', ...(version !== undefined ? { version } : {}) },
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

async function loadCalculation(db: Db, calculationId: string) {
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

type LoadedCalc = NonNullable<Awaited<ReturnType<typeof loadCalculation>>>;

/** Блокировки расчёта: журнал факта (как у перестройки этапов) и строка. */
async function lockCalculation(tx: Tx, calculationId: string) {
  await lockCalculationLedger(tx, calculationId);
  await tx.$queryRaw`SELECT "id" FROM "Calculation" WHERE "id" = ${calculationId} FOR UPDATE`;
}

/** Комплект, с которым работает расчёт: черновик, иначе последний комплект. */
async function workingPackage(db: Db, calculationId: string) {
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

type WorkingPackage = NonNullable<Awaited<ReturnType<typeof workingPackage>>>;

function parseSnapshot(raw: string | null | undefined): GostWizardSnapshot | null {
  if (!raw) return null;
  const s = safeJsonParse<GostWizardSnapshot | null>(raw, null);
  return s && typeof s === 'object' ? s : null;
}

function answersOf(raw: string): Record<string, unknown> {
  const a = safeJsonParse<Record<string, unknown>>(raw, {});
  return a && typeof a === 'object' ? a : {};
}

/**
 * Снимок для новой черновой версии комплекта — как при принятии запроса на
 * изменение (`applyProposedChanges` без изменений): связи и `mappedStageId`
 * переводятся на этапы целевого расчёта (несопоставленные снимаются), подписи,
 * автор ТЗ и шаг мастера не переносятся.
 */
function carrySnapshot(raw: string | null, stageIdMap: Map<string, string>): GostWizardSnapshot {
  return applyProposedChanges(
    parseSnapshot(raw) ?? {},
    { summary: '', items: [] },
    'kit',
    stageIdMap,
  ).snapshot as GostWizardSnapshot;
}

const identityStageMap = (stages: { id: string }[]) => new Map(stages.map((s) => [s.id, s.id]));

/** Проект расчёта в транзакции (нет — найти по названию и заказчику или создать). */
async function ensureProjectTx(tx: Tx, calc: LoadedCalc): Promise<string> {
  if (calc.projectId) return calc.projectId;
  const existing = await tx.project.findFirst({
    where: { name: calc.name.trim(), customer: calc.customer.trim() },
    select: { id: true },
  });
  const projectId =
    existing?.id ??
    (
      await tx.project.create({
        data: {
          name: calc.name.trim(),
          customer: calc.customer.trim(),
          createdBy: calc.createdBy,
        },
        select: { id: true },
      })
    ).id;
  await tx.calculation.update({ where: { id: calc.id }, data: { projectId } });
  return projectId;
}

/** Новая черновая версия комплекта (номер — под блокировкой проекта). */
async function createDraftFrom(
  tx: Tx,
  input: {
    projectId: string;
    calculationId: string;
    base: WorkingPackage['pkg'] | null;
    snapshot: GostWizardSnapshot;
    name: string;
    createdBy: string;
  },
) {
  const base = input.base;
  return createDraftPackageVersion(tx, {
    projectId: input.projectId,
    calculationId: input.calculationId,
    name: input.name,
    standardProfileId: base?.standardProfileId ?? 'ru-gost34-current',
    standardProfileVersion: base?.standardProfileVersion ?? '2020',
    generatorVersion: base?.generatorVersion ?? '0.3.0',
    documentTypes: safeJsonParse<string[]>(base?.documentTypes, ['tz']),
    metadata: base?.metadata ?? null,
    snapshot: input.snapshot,
    createdBy: input.createdBy,
  });
}

/** Условная запись снимка черновика: статус и `updatedAt` не изменились. */
async function writeDraftSnapshot(
  tx: Tx,
  pkg: { id: string; updatedAt: Date },
  snapshot: GostWizardSnapshot,
) {
  const res = await tx.gostPackage.updateMany({
    where: { id: pkg.id, status: 'draft', updatedAt: pkg.updatedAt },
    data: { snapshot: JSON.stringify(snapshot) },
  });
  if (res.count === 0) throw new KitConflict('Черновик комплекта изменён параллельно');
}

async function lockDraftPackage(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "GostPackage" WHERE "id" = ${id} FOR UPDATE`;
  const row = await tx.gostPackage.findUnique({ where: { id } });
  if (!row || row.status !== 'draft') {
    throw new KitConflict('Черновик комплекта перестал быть черновиком');
  }
  return row;
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

function planFor(
  calc: LoadedCalc,
  snapshot: GostWizardSnapshot | null,
  loaded: NonNullable<Awaited<ReturnType<typeof loadApprovedKitVersion>>>,
  selection: KitSelection,
) {
  const usage = collectProjectKitUsage(calc.stages as ProjectStageRow[], calc.risks, snapshot);
  const existing = existingStateFor(usage.get(loaded.kit.id), snapshot);
  const plan = buildApplicationPlan({
    kit: { id: loaded.kit.id, key: loaded.kit.key },
    version: { version: loaded.row.version, content: loaded.content },
    selection,
    answers: answersOf(calc.answers),
    existing,
  });
  return { plan, existing };
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
  const { plan } = planFor(calc, parseSnapshot(working?.pkg.snapshot), loaded, input.selection);
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
 * расчёта в той же транзакции. Пустой план — `noop` без записи.
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
): Promise<KitAppResult<KitAppOutcome>> {
  const loaded = await loadApprovedKitVersion(input.kitId, input.version);
  if (!loaded) return fail(404, 'Утверждённая версия набора не найдена');
  if (loaded.kit.status === 'archived') return fail(409, 'Набор в архиве');
  const pre = await loadCalculation(prisma, input.calculationId);
  if (!pre) return fail(404, 'Расчёт не найден');
  const config = await scheduleConfigFromTemplate(pre.template);
  const kitRef = { id: loaded.kit.id, key: loaded.kit.key };
  const wantsPackage = input.selection.targets.package;

  try {
    return await prisma.$transaction(
      async (tx): Promise<KitAppResult<KitAppOutcome>> => {
        await lockCalculation(tx, pre.id);
        const source = await loadCalculation(tx, pre.id);
        if (!source) return fail(404, 'Расчёт не найден');
        const needsVersion = source.status !== 'draft';
        if (needsVersion && !input.createVersion) {
          return fail(
            409,
            'Расчёт не черновик: создайте новую версию (createVersion) или выберите черновик',
          );
        }
        const working = await workingPackage(tx, source.id);
        const baseSnapshot = parseSnapshot(working?.pkg.snapshot);

        // Пустой план (повтор, всё исключено) — без версий, черновиков и записей.
        if (isEmptyPlan(planFor(source, baseSnapshot, loaded, input.selection).plan)) {
          return {
            ok: true,
            applicationId: null,
            calculationId: source.id,
            packageId: null,
            noop: true,
          };
        }

        // Целевой расчёт и снимок черновика комплекта.
        let target: LoadedCalc = source;
        let projectId = source.projectId;
        let stageIdMap = identityStageMap(source.stages);
        if (needsVersion) {
          const created = await createCalculationVersion(
            {
              parentCalculationId: source.id,
              createdBy: actor.username,
              versionComment: `Применение набора ${loaded.kit.key} v${loaded.row.version}`,
            },
            tx,
          );
          if (!created) return fail(404, 'Расчёт не найден');
          await lockCalculation(tx, created.id);
          const reloaded = await loadCalculation(tx, created.id);
          if (!reloaded) return fail(404, 'Расчёт не найден');
          target = reloaded;
          projectId = created.projectId;
          stageIdMap = matchStageIds(source.stages, target.stages);
        } else if (wantsPackage) {
          projectId = await ensureProjectTx(tx, source);
        }

        let draft: { id: string; updatedAt: Date } | null = null;
        let snapshot: GostWizardSnapshot | null = baseSnapshot;
        if (wantsPackage) {
          if (!needsVersion && working?.isDraft) {
            const row = await lockDraftPackage(tx, working.pkg.id);
            draft = { id: row.id, updatedAt: row.updatedAt };
            snapshot = parseSnapshot(row.snapshot);
          } else {
            snapshot = carrySnapshot(working?.pkg.snapshot ?? null, stageIdMap);
          }
        } else if (needsVersion) {
          snapshot = baseSnapshot ? carrySnapshot(working!.pkg.snapshot, stageIdMap) : null;
        }

        const { plan, existing } = planFor(target, snapshot, loaded, input.selection);
        const answers = answersOf(target.answers);

        let stageIdByElement = new Map(existing.stageIdByElement);
        if (plan.stages.length > 0) {
          const primary = [
            ...primaryInputsFromStageRows(target.stages),
            ...plan.stages.map((s) => ({
              name: s.name,
              role: s.role,
              hours: s.hours,
              requirements: s.requirements,
              originRef: s.originRef,
            })),
          ];
          await tx.calculation.update({
            where: { id: target.id },
            data: { pmHours: pmHoursFor(target.template.fields, answers, primary) },
          });
          await rebuildStagesTx(tx, target.id, primary, target.startDate, config);
          stageIdByElement = await kitStageIds(tx, target.id, kitRef.id);
        }

        const riskIds: Record<string, string> = {};
        let order = target.risks.reduce((m, r) => Math.max(m, r.order), -1);
        for (const r of plan.risks) {
          const row = await tx.risk.create({
            data: {
              calculationId: target.id,
              description: r.description,
              hours: r.hours,
              order: ++order,
              originRef: r.originRef,
            },
            select: { id: true },
          });
          riskIds[r.elementId] = row.id;
        }

        let packageId: string | null = null;
        let links: { requirementId: string; stageId: string }[] = [];
        if (wantsPackage) {
          const applied = applyPlanToSnapshot(
            snapshot,
            plan,
            stageIdByElement,
            existing.requirementIdByElement,
          );
          links = applied.links;
          if (draft) {
            await writeDraftSnapshot(tx, draft, applied.snapshot);
            packageId = draft.id;
          } else {
            const pkg = await createDraftFrom(tx, {
              projectId: projectId!,
              calculationId: target.id,
              base: working?.pkg ?? null,
              snapshot: applied.snapshot,
              name: working
                ? `${working.pkg.name} · набор ${kitRef.key} v${loaded.row.version}`
                : `Черновик комплекта ГОСТ 34 · набор ${kitRef.key} v${loaded.row.version}`,
              createdBy: actor.username,
            });
            packageId = pkg.id;
          }
        }

        const mapping = {
          stages: Object.fromEntries(
            plan.stages.map((s) => [s.elementId, stageIdByElement.get(s.elementId) ?? null]),
          ),
          risks: riskIds,
          requirements: Object.fromEntries(
            plan.requirements.map((r) => [r.origin.elementId, r.id]),
          ),
          checks: Object.fromEntries(
            plan.checks.map((c) => [c.origin.elementId, c.requirementIds]),
          ),
          fragments: Object.fromEntries(
            plan.fragments.map((f) => [f.origin.elementId, f.sectionKey]),
          ),
          links,
          skipped: plan.skipped,
          driverValues: plan.driverValues,
          ...(needsVersion ? { sourceCalculationId: source.id } : {}),
        };
        const app = await tx.kitApplication.create({
          data: {
            kind: 'apply',
            kitId: kitRef.id,
            kitVersionId: loaded.row.id,
            calculationId: target.id,
            packageId,
            selection: json(input.selection),
            mapping: json(mapping),
            appliedBy: actor.username,
          },
          select: { id: true },
        });
        return {
          ok: true,
          applicationId: app.id,
          calculationId: target.id,
          packageId,
          noop: false,
        };
      },
      { timeout: 60_000 },
    );
  } catch (e) {
    if (e instanceof KitConflict) return fail(409, e.message);
    throw e;
  }
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
  const usage = collectProjectKitUsage(calc.stages as ProjectStageRow[], calc.risks, snapshot);
  const proposals: (KitUpdateProposal & { kitName: string })[] = [];
  for (const u of usage.values()) {
    const p = await proposalFor(prisma, u, calc.answers, snapshot !== null, explicitDrivers);
    if (p && p.changes.length > 0) proposals.push(p);
  }
  return { ok: true, proposals };
}

async function proposalFor(
  db: Db,
  usage: ProjectKitUsage,
  answersRaw: string,
  hasPackage: boolean,
  explicitDrivers: Record<string, number>,
) {
  const latest = await loadApprovedKitVersion(usage.kitId, undefined, db);
  if (!latest) return null;
  if (usage.versions.every((v) => v >= latest.row.version)) return null;
  const rows = await db.solutionKitVersion.findMany({
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
    latestRowId: latest.row.id,
    latest,
  };
}

const sameSet = (a: unknown, b: Set<string>) =>
  Array.isArray(a) && a.length === b.size && a.every((x) => b.has(String(x)));

/**
 * Перенос выбранных изменений последней утверждённой версии набора в НОВУЮ
 * черновую версию расчёта (и черновую версию комплекта при нём). Исходный
 * расчёт и его комплекты не меняются. Повторная отправка того же выбора
 * для того же исходного расчёта и той же версии набора — 409.
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
): Promise<KitAppResult<KitAppOutcome>> {
  const selected = new Set(input.elementIds);
  if (selected.size === 0) return fail(400, 'Не выбрано ни одного изменения');
  const pre = await loadCalculation(prisma, input.calculationId);
  if (!pre) return fail(404, 'Расчёт не найден');
  const config = await scheduleConfigFromTemplate(pre.template);

  try {
    return await prisma.$transaction(
      async (tx): Promise<KitAppResult<KitAppOutcome>> => {
        // Сначала — блокировка исходного расчёта и перечитывание под ней.
        await lockCalculation(tx, pre.id);
        const source = await loadCalculation(tx, pre.id);
        if (!source) return fail(404, 'Расчёт не найден');
        const sourcePkg = await workingPackage(tx, source.id);
        const sourceSnapshot = parseSnapshot(sourcePkg?.pkg.snapshot);
        const usage = collectProjectKitUsage(
          source.stages as ProjectStageRow[],
          source.risks,
          sourceSnapshot,
        ).get(input.kitId);
        if (!usage) return fail(404, 'Набор в проекте не используется');
        const proposal = await proposalFor(
          tx,
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
        for (const id of selected) {
          if (!known.has(id)) return fail(400, `Изменение «${id}» отсутствует в предложении`);
        }
        // Защита от повторной отправки: та же версия, тот же исходный расчёт, тот же выбор.
        const previous = await tx.kitApplication.findMany({
          where: {
            kind: 'update',
            kitVersionId: proposal.latestRowId,
            mapping: { path: ['sourceCalculationId'], equals: source.id },
          },
          select: { calculationId: true, selection: true },
        });
        const dup = previous.find((p) =>
          sameSet((p.selection as { elementIds?: unknown })?.elementIds, selected),
        );
        if (dup) {
          return fail(409, `Эти изменения уже перенесены в версию расчёта ${dup.calculationId}`);
        }
        const fromRow = await tx.solutionKitVersion.findUnique({
          where: { kitId_version: { kitId: input.kitId, version: Math.max(...usage.versions) } },
          select: { id: true },
        });
        if (!fromRow) return fail(409, 'Исходная версия набора не найдена');
        const to = proposal.latest;
        const kitRef = { id: to.kit.id, key: to.kit.key };

        const created = await createCalculationVersion(
          {
            parentCalculationId: source.id,
            createdBy: actor.username,
            versionComment: `Обновление набора ${to.kit.key} до v${to.row.version}`,
          },
          tx,
        );
        if (!created) return fail(404, 'Расчёт не найден');
        await lockCalculation(tx, created.id);
        const calc = await loadCalculation(tx, created.id);
        if (!calc) return fail(404, 'Расчёт не найден');
        const answers = answersOf(calc.answers);
        const driverValues = resolveDriverValues(to.content, answers, input.driverValues ?? {});
        const stageIdMap = matchStageIds(source.stages, calc.stages);
        const carried = sourcePkg ? carrySnapshot(sourcePkg.pkg.snapshot, stageIdMap) : null;
        const newUsage = collectProjectKitUsage(
          calc.stages as ProjectStageRow[],
          calc.risks,
          carried,
        ).get(kitRef.id) ?? { ...usage, elements: new Map() };

        const calcPlan = planCalculationUpdate({
          kit: kitRef,
          to: { version: to.row.version, content: to.content },
          proposal,
          selected,
          usage: newUsage,
          stages: calc.stages as ProjectStageRow[],
          risks: calc.risks as ProjectRiskRow[],
          snapshot: carried,
          driverValues,
          hasPackage: carried !== null,
        });
        await tx.calculation.update({
          where: { id: calc.id },
          data: { pmHours: pmHoursFor(calc.template.fields, answers, calcPlan.primary) },
        });
        const liveStageIds = new Set(
          await rebuildStagesTx(tx, calc.id, calcPlan.primary, calc.startDate, config),
        );
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
        if (carried && sourcePkg) {
          const snapshot = applySnapshotUpdate({
            kit: kitRef,
            to: { version: to.row.version, content: to.content },
            proposal,
            selected,
            snapshot: carried,
            addPlan: calcPlan.addPlan,
            stageIdByElement: await kitStageIds(tx, calc.id, kitRef.id),
            liveStageIds,
          });
          const pkg = await createDraftFrom(tx, {
            projectId: created.projectId!,
            calculationId: calc.id,
            base: sourcePkg.pkg,
            snapshot,
            name: `${sourcePkg.pkg.name} · набор ${kitRef.key} v${to.row.version}`,
            createdBy: actor.username,
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
        return { ok: true, applicationId: app.id, calculationId: calc.id, packageId, noop: false };
      },
      { timeout: 60_000 },
    );
  } catch (e) {
    if (e instanceof KitConflict) return fail(409, e.message);
    throw e;
  }
}
