/**
 * Журнал факта (#103 WP-6a): запись в БД. Логика решений — `lib/actualsLedger.ts`.
 *
 * Любая запись факта проходит через журнал: синхронизация источника
 * (`syncLedgerSource`) или ручная правка (`recordManualStageEdit`), после чего
 * затронутые этапы пересчитываются (`recomputeStageActuals`). Прямых записей в
 * `Stage.actualHours`/даты факта больше нет. Все записи по расчёту
 * сериализуются транзакционной advisory-блокировкой (`lockCalculationLedger`).
 */
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/lib/generated/prisma/client';
import {
  MANUAL_SOURCE,
  aggregateStageActuals,
  manualAdjustmentExternalId,
  manualExternalId,
  planCounts,
  planManualHours,
  planSync,
  type LedgerEntryInput,
  type ManualHoursMode,
  type StoredLedgerEntry,
  type SyncMode,
  type SyncPlan,
} from '@/lib/actualsLedger';

type Tx = Prisma.TransactionClient;

const entrySelect = {
  id: true,
  source: true,
  externalId: true,
  stageId: true,
  externalTaskKey: true,
  author: true,
  hours: true,
  startDate: true,
  endDate: true,
  externalUpdatedAt: true,
  basis: true,
  deletedAt: true,
} as const;

/** Конфликт параллельной записи журнала (P2002 после гонки) — для ответа 409. */
export function isLedgerConflict(e: unknown): boolean {
  return Boolean(e && typeof e === 'object' && (e as { code?: string }).code === 'P2002');
}

/**
 * Транзакционная блокировка журнала расчёта: синхронизации, ручные правки и
 * сопоставления одного расчёта выполняются по очереди, без гонок за upsert.
 */
export async function lockCalculationLedger(tx: Tx, calculationId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`actuals:${calculationId}`}))`;
}

/** Пересчитывает агрегат факта этапов по неудалённым записям журнала. */
export async function recomputeStageActuals(tx: Tx, stageIds: Iterable<string>): Promise<void> {
  const ids = [...new Set([...stageIds].filter(Boolean))];
  if (ids.length === 0) return;
  const entries = await tx.actualEntry.findMany({
    where: { stageId: { in: ids }, deletedAt: null },
    select: entrySelect,
  });
  for (const stageId of ids) {
    const agg = aggregateStageActuals(entries.filter((e) => e.stageId === stageId));
    await tx.stage.update({ where: { id: stageId }, data: agg });
  }
}

function entryData(e: LedgerEntryInput, now: Date) {
  return {
    stageId: e.stageId,
    externalTaskKey: e.externalTaskKey ?? null,
    author: e.author ?? null,
    hours: e.hours,
    startDate: e.startDate ?? null,
    endDate: e.endDate ?? null,
    externalUpdatedAt: e.externalUpdatedAt ?? null,
    syncedAt: now,
    deletedAt: null,
  };
}

export interface LedgerSyncInput {
  calculationId: string;
  source: string;
  entries: LedgerEntryInput[];
  mode: SyncMode;
  /** externalId, которые были во входе, но не записываются (не защищают от удаления). */
  keepExternalIds?: string[];
  startedBy?: string | null;
  cursor?: string | null;
  errors?: unknown[];
  dryRun?: boolean;
  /**
   * Этапы, чьи ручные часы (база и поправка) заменяются данными источника:
   * часы базы обнуляются (даты остаются), поправка снимается.
   */
  supersedeManualStageIds?: string[];
  /** Режим обращения с ручными часами — записывается в ActualSyncRun. */
  manualHoursMode?: ManualHoursMode | null;
  /** Выполняется в той же транзакции до пересчёта этапов (например, сопоставления). */
  afterWrite?: (tx: Tx) => Promise<Iterable<string> | void>;
}

export interface LedgerSyncResult {
  counts: ReturnType<typeof planCounts>;
  plan: SyncPlan;
  /** Этапы, чьи ручные часы сброшены (или будут сброшены при dryRun). */
  manualResetStageIds: string[];
  runId: string | null;
}

/** Этапы, данные которых меняет план: новые и прежние этапы изменённых записей. */
function touchedStages(plan: SyncPlan, existing: StoredLedgerEntry[]): Set<string> {
  const prevStage = new Map(existing.map((e) => [e.id, e.stageId]));
  const touched = new Set<string>();
  for (const e of plan.create) if (e.stageId) touched.add(e.stageId);
  for (const u of plan.update) {
    if (u.entry.stageId) touched.add(u.entry.stageId);
    const was = prevStage.get(u.id);
    if (was) touched.add(was);
  }
  for (const id of plan.remove) {
    const was = prevStage.get(id);
    if (was) touched.add(was);
  }
  return touched;
}

/**
 * Идемпотентная синхронизация записей одного источника по расчёту: upsert по
 * (calculationId, source, externalId), исправления заменяют значения,
 * пропавшие при `full` помечаются `deletedAt`. `dryRun` возвращает только план.
 *
 * Ручные записи синхронизация не трогает, кроме одного случая: полная
 * синхронизация (`full`), изменившая записи этапа, снимает ручную поправку
 * этапа, если та была посчитана относительно этого же источника — поправка
 * подгоняла итог под старые данные источника. Базовая ручная запись (ввод без
 * источников, перенос миграцией) меняется только по явному
 * `supersedeManualStageIds` (обнуляются часы); ручные даты не меняются никогда.
 */
export async function syncLedgerSource(input: LedgerSyncInput): Promise<LedgerSyncResult> {
  if (input.source === MANUAL_SOURCE) throw new Error('manual пишется только ручной правкой');
  const run = async (tx: Tx): Promise<LedgerSyncResult> => {
    if (!input.dryRun) await lockCalculationLedger(tx, input.calculationId);
    const existing = (await tx.actualEntry.findMany({
      where: { calculationId: input.calculationId, source: input.source },
      select: entrySelect,
    })) as StoredLedgerEntry[];
    const plan = planSync(existing, input.entries, {
      mode: input.mode,
      keepExternalIds: input.keepExternalIds,
    });
    const counts = planCounts(plan);
    const touched = touchedStages(plan, existing);
    const adjustments =
      input.mode !== 'full' || touched.size === 0
        ? []
        : await tx.actualEntry.findMany({
            where: {
              calculationId: input.calculationId,
              source: MANUAL_SOURCE,
              stageId: { in: [...touched] },
              deletedAt: null,
            },
            select: { id: true, stageId: true, externalId: true, basis: true },
          });
    const manualToReset = adjustments.filter(
      (m) => m.externalId.startsWith('adj:') && (m.basis ?? '').split(',').includes(input.source),
    );
    const supersede = input.supersedeManualStageIds ?? [];
    const superseded = supersede.length
      ? await tx.actualEntry.findMany({
          where: {
            calculationId: input.calculationId,
            source: MANUAL_SOURCE,
            stageId: { in: supersede },
            deletedAt: null,
            hours: { not: null },
          },
          select: { id: true, stageId: true, externalId: true, startDate: true, endDate: true },
        })
      : [];
    const manualResetStageIds = [
      ...new Set([...manualToReset, ...superseded].map((m) => m.stageId as string)),
    ];
    if (input.dryRun) return { counts, plan, manualResetStageIds, runId: null };

    const now = new Date();
    for (const e of plan.create) {
      await tx.actualEntry.create({
        data: {
          calculationId: input.calculationId,
          source: input.source,
          externalId: e.externalId,
          ...entryData(e, now),
        },
      });
    }
    for (const u of plan.update) {
      await tx.actualEntry.update({ where: { id: u.id }, data: entryData(u.entry, now) });
    }
    if (plan.unchanged.length) {
      await tx.actualEntry.updateMany({
        where: { id: { in: plan.unchanged } },
        data: { syncedAt: now },
      });
    }
    const softDelete = [...plan.remove, ...manualToReset.map((m) => m.id)];
    for (const m of superseded) {
      touched.add(m.stageId as string);
      if (m.externalId.startsWith('adj:') || (!m.startDate && !m.endDate)) {
        softDelete.push(m.id);
      } else {
        // Базовая запись с ручными датами: часы уходят, даты остаются.
        await tx.actualEntry.update({ where: { id: m.id }, data: { hours: null, syncedAt: now } });
      }
    }
    if (softDelete.length) {
      await tx.actualEntry.updateMany({
        where: { id: { in: softDelete } },
        data: { deletedAt: now },
      });
    }
    const moved = input.afterWrite ? await input.afterWrite(tx) : undefined;
    for (const id of moved ?? []) touched.add(id);
    await recomputeStageActuals(tx, touched);
    const syncRun = await tx.actualSyncRun.create({
      data: {
        calculationId: input.calculationId,
        source: input.source,
        mode: input.mode,
        startedBy: input.startedBy ?? null,
        cursor: input.cursor ?? null,
        manualHours: input.manualHoursMode ?? null,
        ...counts,
        errors: (input.errors ?? []) as Prisma.InputJsonValue,
      },
    });
    return { counts, plan, manualResetStageIds, runId: syncRun.id };
  };
  return input.dryRun ? run(prisma as unknown as Tx) : prisma.$transaction(run);
}

export interface ManualStageEdit {
  calculationId: string;
  stageId: string;
  /** undefined — не менять; null — убрать ручные часы (записи источников остаются). */
  hours?: number | null;
  startDate?: Date | null;
  endDate?: Date | null;
}

async function upsertManual(
  tx: Tx,
  calculationId: string,
  stageId: string,
  externalId: string,
  data: {
    hours?: number | null;
    startDate?: Date | null;
    endDate?: Date | null;
    basis?: string | null;
  },
  prev: { hours: number | null; startDate: Date | null; endDate: Date | null } | undefined,
  now: Date,
) {
  const next = {
    hours: data.hours !== undefined ? data.hours : (prev?.hours ?? null),
    startDate: data.startDate !== undefined ? data.startDate : (prev?.startDate ?? null),
    endDate: data.endDate !== undefined ? data.endDate : (prev?.endDate ?? null),
    ...(data.basis !== undefined ? { basis: data.basis } : {}),
  };
  const empty = next.hours === null && !next.startDate && !next.endDate;
  if (!prev && empty) return;
  await tx.actualEntry.upsert({
    where: {
      calculationId_source_externalId: { calculationId, source: MANUAL_SOURCE, externalId },
    },
    create: {
      calculationId,
      stageId,
      source: MANUAL_SOURCE,
      externalId,
      ...next,
      syncedAt: now,
      deletedAt: empty ? now : null,
    },
    update: { stageId, ...next, syncedAt: now, deletedAt: empty ? now : null },
  });
}

/**
 * Ручная правка факта этапа (см. `planManualHours`).
 *
 * - Часы без других источников пишутся в базовую ручную запись `stage:<id>`;
 *   поверх источников — в поправку `adj:<id>` с перечнем источников, так что
 *   итог этапа равен введённому.
 * - null убирает ручные часы (базу и поправку); записи источников не трогаются.
 * - Даты живут в базовой записи и перекрывают начало по источникам; окончание
 *   этапа задаётся только вручную.
 */
export async function recordManualStageEdit(tx: Tx, edit: ManualStageEdit): Promise<void> {
  await lockCalculationLedger(tx, edit.calculationId);
  const now = new Date();
  const entries = await tx.actualEntry.findMany({
    where: { stageId: edit.stageId, deletedAt: null },
    select: entrySelect,
  });
  const baseId = manualExternalId(edit.stageId);
  const adjId = manualAdjustmentExternalId(edit.stageId);
  const base = entries.find((e) => e.source === MANUAL_SOURCE && e.externalId === baseId);
  const adj = entries.find((e) => e.source === MANUAL_SOURCE && e.externalId === adjId);

  const baseData: { hours?: number | null; startDate?: Date | null; endDate?: Date | null } = {};
  if (edit.startDate !== undefined) baseData.startDate = edit.startDate;
  if (edit.endDate !== undefined) baseData.endDate = edit.endDate;
  if (edit.hours !== undefined) {
    const plan = planManualHours(edit.hours, base?.hours ?? null, entries);
    if (plan.baseHours !== undefined) baseData.hours = plan.baseHours;
    await upsertManual(
      tx,
      edit.calculationId,
      edit.stageId,
      adjId,
      plan.adjustment
        ? { hours: plan.adjustment.hours, basis: plan.adjustment.basis.join(',') }
        : { hours: null, basis: null },
      adj,
      now,
    );
  }
  if (Object.keys(baseData).length) {
    await upsertManual(tx, edit.calculationId, edit.stageId, baseId, baseData, base, now);
  }
  await recomputeStageActuals(tx, [edit.stageId]);
}

/** Ручные часы этапов (база и поправка) — для превью импорта. */
export async function loadManualHours(
  calculationId: string,
  stageIds: string[],
): Promise<Record<string, { base: number | null; adjustment: number | null }>> {
  if (stageIds.length === 0) return {};
  const rows = await prisma.actualEntry.findMany({
    where: {
      calculationId,
      source: MANUAL_SOURCE,
      stageId: { in: stageIds },
      deletedAt: null,
      hours: { not: null },
    },
    select: { stageId: true, externalId: true, hours: true },
  });
  const out: Record<string, { base: number | null; adjustment: number | null }> = {};
  for (const r of rows) {
    const o = (out[r.stageId as string] ??= { base: null, adjustment: null });
    if (r.externalId.startsWith('adj:')) o.adjustment = r.hours;
    else o.base = r.hours;
  }
  return out;
}

/** Сопоставления задач источника с этапами расчёта: ключ задачи → stageId. */
export async function loadTaskMappings(
  calculationId: string,
  source: string,
): Promise<Record<string, string>> {
  const rows = await prisma.externalTaskMapping.findMany({
    where: { calculationId, source },
    select: { externalTaskKey: true, stageId: true },
  });
  return Object.fromEntries(rows.map((r) => [r.externalTaskKey, r.stageId]));
}

/**
 * Сохраняет сопоставления и переносит на этап уже записанные записи этих
 * задач (несопоставленные worklog трекера или ранее сопоставленные с другим
 * этапом). Возвращает этапы для пересчёта; вызывается внутри транзакции.
 */
export async function applyTaskMappings(
  tx: Tx,
  calculationId: string,
  source: string,
  mappings: Record<string, string>,
  createdBy: string | null,
): Promise<Set<string>> {
  const touched = new Set<string>();
  for (const [externalTaskKey, stageId] of Object.entries(mappings)) {
    await tx.externalTaskMapping.upsert({
      where: {
        calculationId_source_externalTaskKey: { calculationId, source, externalTaskKey },
      },
      create: { calculationId, source, externalTaskKey, stageId, createdBy },
      update: { stageId },
    });
    const moved = await tx.actualEntry.findMany({
      where: { calculationId, source, externalTaskKey, deletedAt: null },
      select: { id: true, stageId: true },
    });
    const toMove = moved.filter((e) => e.stageId !== stageId);
    if (toMove.length === 0) continue;
    await tx.actualEntry.updateMany({
      where: { id: { in: toMove.map((e) => e.id) } },
      data: { stageId },
    });
    touched.add(stageId);
    for (const e of toMove) if (e.stageId) touched.add(e.stageId);
  }
  return touched;
}

/** Сохраняет сопоставления отдельной транзакцией (вне синхронизации). */
export async function saveTaskMappings(
  calculationId: string,
  source: string,
  mappings: Record<string, string>,
  createdBy: string | null,
): Promise<void> {
  if (Object.keys(mappings).length === 0) return;
  await prisma.$transaction(async (tx) => {
    await lockCalculationLedger(tx, calculationId);
    const touched = await applyTaskMappings(tx, calculationId, source, mappings, createdBy);
    await recomputeStageActuals(tx, touched);
  });
}

export interface LedgerSourceInfo {
  source: string;
  /** Записи, привязанные к этапам (входят в агрегат). */
  entries: number;
  hours: number;
  /** Записи без этапа (задача не сопоставлена) — в агрегат не входят. */
  unassignedEntries: number;
  unassignedHours: number;
  lastSyncedAt: string | null;
  lastRun: { mode: string; createdAt: string; counts: ReturnType<typeof planCounts> } | null;
}

/** Сводка журнала по расчёту для панели факта: источники и время синхронизации. */
export async function loadLedgerOverview(calculationId: string): Promise<{
  sources: LedgerSourceInfo[];
  stageSources: Record<string, string[]>;
}> {
  const [entries, runs] = await Promise.all([
    prisma.actualEntry.findMany({
      where: { calculationId, deletedAt: null },
      select: { source: true, stageId: true, hours: true, syncedAt: true },
    }),
    prisma.actualSyncRun.findMany({
      where: { calculationId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
  ]);
  const bySource = new Map<string, LedgerSourceInfo>();
  const info = (source: string) => {
    let i = bySource.get(source);
    if (!i) {
      i = {
        source,
        entries: 0,
        hours: 0,
        unassignedEntries: 0,
        unassignedHours: 0,
        lastSyncedAt: null,
        lastRun: null,
      };
      bySource.set(source, i);
    }
    return i;
  };
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const stageSources: Record<string, string[]> = {};
  for (const e of entries) {
    const i = info(e.source);
    if (e.stageId) {
      i.entries += 1;
      i.hours = r2(i.hours + (e.hours ?? 0));
      const list = (stageSources[e.stageId] ??= []);
      if (!list.includes(e.source)) list.push(e.source);
    } else {
      i.unassignedEntries += 1;
      i.unassignedHours = r2(i.unassignedHours + (e.hours ?? 0));
    }
    const at = e.syncedAt.toISOString();
    if (!i.lastSyncedAt || at > i.lastSyncedAt) i.lastSyncedAt = at;
  }
  for (const r of runs) {
    const i = info(r.source);
    if (i.lastRun) continue;
    i.lastRun = {
      mode: r.mode,
      createdAt: r.createdAt.toISOString(),
      counts: {
        created: r.created,
        updated: r.updated,
        unchanged: r.unchanged,
        deleted: r.deleted,
        skipped: r.skipped,
      },
    };
    const at = r.createdAt.toISOString();
    if (!i.lastSyncedAt || at > i.lastSyncedAt) i.lastSyncedAt = at;
  }
  return { sources: [...bySource.values()], stageSources };
}
