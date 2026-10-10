/**
 * Журнал факта (#103 WP-6a): чистая логика без Prisma.
 *
 * Факт по этапу хранится записями `ActualEntry` из разных источников
 * (`csv`, `manual`, трекер). `Stage.actualHours` и даты факта — агрегат
 * неудалённых записей; здесь — агрегатор, план идемпотентной синхронизации
 * (upsert по `externalId`, исправления заменяют значения, политика удаления
 * при полной синхронизации), ручная поправка и разбор CSV в записи.
 * Работа с БД — `lib/actualsLedgerData.ts`, правила — `docs/actuals-ledger.md`.
 */
import { createHash } from 'node:crypto';
import type { ActualsCsvRow } from './actuals';

export const MANUAL_SOURCE = 'manual';
export const CSV_SOURCE = 'csv';

/** Совпадает с CHECK в миграции: 'csv' | 'manual' | идентификатор трекера. */
export function isValidSource(source: string): boolean {
  return /^[a-z][a-z0-9_-]{0,31}$/.test(source);
}

/**
 * externalId базовой ручной записи этапа: часы, введённые без других
 * источников (или перенесённые миграцией), и ручные даты. Синхронизация
 * источников её никогда не трогает.
 */
export function manualExternalId(stageId: string): string {
  return `stage:${stageId}`;
}

/**
 * externalId ручной поправки: часы, введённые поверх других источников, чтобы
 * итог этапа стал равен введённому. В `basis` — источники, относительно
 * которых поправка посчитана.
 */
export function manualAdjustmentExternalId(stageId: string): string {
  return `adj:${stageId}`;
}

export function isManualBase(e: { source: string; externalId: string }): boolean {
  return e.source === MANUAL_SOURCE && e.externalId.startsWith('stage:');
}

export type SyncMode = 'incremental' | 'full';

/** Запись, пришедшая из источника (ещё не в БД). */
export interface LedgerEntryInput {
  externalId: string;
  stageId: string | null;
  externalTaskKey?: string | null;
  author?: string | null;
  /** null — запись несёт только даты. */
  hours: number | null;
  startDate?: Date | null;
  endDate?: Date | null;
  /** Время правки записи во внешней системе: более старая версия не затирает новую. */
  externalUpdatedAt?: Date | null;
}

/** Запись журнала, как она лежит в БД. */
export interface StoredLedgerEntry extends LedgerEntryInput {
  id: string;
  source: string;
  /** Для ручной поправки: источники, относительно которых она посчитана. */
  basis?: string | null;
  deletedAt: Date | null;
}

// ---------------------------------------------------------------------------
// Агрегат по этапу
// ---------------------------------------------------------------------------

export interface StageActualsAggregate {
  actualHours: number | null;
  actualStartDate: Date | null;
  actualEndDate: Date | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const time = (d: Date | null | undefined) => (d ? d.getTime() : null);

/**
 * Агрегат неудалённых записей одного этапа.
 *
 * - Часы — сумма записей с часами (ручная поправка может быть отрицательной);
 *   итог не меньше нуля; нет ни одной записи с часами — null.
 * - Начало — ручная дата, если задана, иначе самая ранняя дата записей
 *   источников (worklog показывает, что работа началась).
 * - Окончание — только ручная дата: окончание этапа означает «этап завершён»
 *   (`lib/schedule.ts`), а дата последнего worklog этого не означает.
 */
export function aggregateStageActuals(
  entries: Pick<
    StoredLedgerEntry,
    'source' | 'externalId' | 'hours' | 'startDate' | 'endDate' | 'deletedAt'
  >[],
): StageActualsAggregate {
  const live = entries.filter((e) => !e.deletedAt);
  const withHours = live.filter((e) => e.hours !== null && e.hours !== undefined);
  const actualHours = withHours.length
    ? Math.max(0, round2(withHours.reduce((s, e) => s + (e.hours as number), 0)))
    : null;
  const base = live.find(isManualBase);
  let start: Date | null = base?.startDate ?? null;
  if (!start) {
    for (const e of live) {
      if (e.source === MANUAL_SOURCE) continue;
      const d = e.startDate ?? e.endDate ?? null;
      if (d && (!start || d.getTime() < start.getTime())) start = d;
    }
  }
  return { actualHours, actualStartDate: start, actualEndDate: base?.endDate ?? null };
}

// ---------------------------------------------------------------------------
// Ручная правка
// ---------------------------------------------------------------------------

export interface ManualHoursPlan {
  /** Новые часы базовой ручной записи (undefined — не менять). */
  baseHours?: number | null;
  /** Поправка поверх источников; null — поправки нет. */
  adjustment: { hours: number; basis: string[] } | null;
}

/**
 * Как записать введённый итог этапа.
 *
 * - Других источников с часами нет — это обычный ручной ввод: часы пишутся в
 *   базовую запись, поправки нет.
 * - Источники есть — базовая запись не меняется, а поправка = введённое −
 *   (база + источники), с перечнем источников, против которых она посчитана.
 * - null — убрать ручные часы (базу и поправку); записи источников не трогаются.
 */
export function planManualHours(
  desiredTotal: number | null,
  baseHours: number | null,
  sources: { source: string; hours: number | null }[],
): ManualHoursPlan {
  if (desiredTotal === null) return { baseHours: null, adjustment: null };
  const counted = sources.filter((e) => e.source !== MANUAL_SOURCE && e.hours !== null);
  if (counted.length === 0) return { baseHours: desiredTotal, adjustment: null };
  const sum = counted.reduce((s, e) => s + (e.hours as number), 0);
  const hours = round2(desiredTotal - (baseHours ?? 0) - sum);
  return {
    adjustment:
      hours === 0 ? null : { hours, basis: [...new Set(counted.map((e) => e.source))].sort() },
  };
}

// ---------------------------------------------------------------------------
// План синхронизации
// ---------------------------------------------------------------------------

export interface SyncPlan {
  create: LedgerEntryInput[];
  /** Исправление значений или возврат ранее удалённой записи. */
  update: { id: string; entry: LedgerEntryInput; revived: boolean }[];
  unchanged: string[];
  /** Помечаются deletedAt (только при полной синхронизации). */
  remove: string[];
  /** Входящие дубли externalId и устаревшие версии (externalUpdatedAt старее). */
  skipped: string[];
}

function sameEntry(a: LedgerEntryInput, b: LedgerEntryInput): boolean {
  return (
    (a.stageId ?? null) === (b.stageId ?? null) &&
    (a.hours ?? null) === (b.hours ?? null) &&
    time(a.startDate) === time(b.startDate) &&
    time(a.endDate) === time(b.endDate) &&
    (a.externalTaskKey ?? null) === (b.externalTaskKey ?? null) &&
    (a.author ?? null) === (b.author ?? null)
  );
}

/**
 * Сравнивает записи источника в БД с пришедшими и решает, что создать,
 * исправить, оставить и удалить. Повтор той же выгрузки даёт только
 * `unchanged` — факт не удваивается.
 *
 * Политика пропавших записей: при `mode: 'full'` неудалённые записи
 * источника, которых нет во входе (и нет в `keepExternalIds` — например,
 * строки CSV, не сопоставленные с этапом), помечаются `deletedAt`. При
 * `incremental` (выгрузка «с курсора») пропавшие записи не трогаются.
 */
export function planSync(
  existing: StoredLedgerEntry[],
  incoming: LedgerEntryInput[],
  opts: { mode: SyncMode; keepExternalIds?: Iterable<string> } = { mode: 'incremental' },
): SyncPlan {
  const plan: SyncPlan = { create: [], update: [], unchanged: [], remove: [], skipped: [] };
  const byId = new Map(existing.map((e) => [e.externalId, e]));
  const seen = new Set<string>(opts.keepExternalIds ?? []);
  const lastIndex = new Map<string, number>();
  incoming.forEach((e, i) => lastIndex.set(e.externalId, i));

  incoming.forEach((entry, i) => {
    if (lastIndex.get(entry.externalId) !== i) {
      plan.skipped.push(entry.externalId); // дубль во входе: побеждает последняя строка
      return;
    }
    seen.add(entry.externalId);
    const prev = byId.get(entry.externalId);
    if (!prev) {
      plan.create.push(entry);
      return;
    }
    const stale =
      entry.externalUpdatedAt &&
      prev.externalUpdatedAt &&
      entry.externalUpdatedAt.getTime() < prev.externalUpdatedAt.getTime();
    if (stale) {
      plan.skipped.push(entry.externalId);
      return;
    }
    if (!prev.deletedAt && sameEntry(prev, entry)) {
      plan.unchanged.push(prev.id);
      return;
    }
    plan.update.push({ id: prev.id, entry, revived: Boolean(prev.deletedAt) });
  });

  if (opts.mode === 'full') {
    for (const e of existing) {
      if (!e.deletedAt && !seen.has(e.externalId)) plan.remove.push(e.id);
    }
  }
  return plan;
}

export function planCounts(plan: SyncPlan) {
  return {
    created: plan.create.length,
    updated: plan.update.length,
    unchanged: plan.unchanged.length,
    deleted: plan.remove.length,
    skipped: plan.skipped.length,
  };
}

// ---------------------------------------------------------------------------
// CSV → записи журнала
// ---------------------------------------------------------------------------

function norm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function parseDay(v: string | undefined): Date | null {
  if (!v) return null;
  const ru = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(v.trim());
  const d = ru ? new Date(Date.UTC(+ru[3], +ru[2] - 1, +ru[1])) : new Date(v.trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * externalId строки CSV: явный столбец `id`, если он есть; иначе стабильный
 * хэш (задача или этап, дата, автор). Для старого формата `этап;часы[;начало;
 * окончание]` даты и автора нет, и ключом становится сам этап — повторный
 * импорт исправляет значение этапа, как и раньше.
 */
export function csvExternalId(row: ActualsCsvRow): string {
  const id = row.id?.trim();
  if (id) {
    return id.length <= 190
      ? `id:${id}`
      : `idh:${createHash('sha256').update(id).digest('hex').slice(0, 32)}`;
  }
  // Дата нормализуется: «02.03.2026» и «2026-03-02» — одна и та же запись.
  const day = parseDay(row.date)?.toISOString().slice(0, 10) ?? (row.date ?? '').trim();
  const key = [norm(row.task) || norm(row.stage), day, norm(row.author)].join('\u001f');
  return `h:${createHash('sha256').update(key).digest('hex').slice(0, 32)}`;
}

export interface CsvStage {
  id: string;
  name: string;
  isApprovalTask: boolean;
}

export interface CsvLedgerResult {
  /** Сопоставленные записи, готовые к синхронизации. */
  entries: LedgerEntryInput[];
  /** Для превью: этап и часы каждой записи. */
  matched: {
    externalId: string;
    stageId: string;
    name: string;
    hours: number;
    task?: string;
    start?: string;
    end?: string;
  }[];
  /** externalId всех разобранных строк, включая несопоставленные. */
  allExternalIds: string[];
  unmatched: string[];
  ambiguous: string[];
  /** Ключи задач без сопоставления с этапом — их можно сопоставить в превью. */
  unmappedTasks: string[];
  /** Явные id, встретившиеся в файле больше одного раза (берётся последняя строка). */
  duplicateIds: string[];
  /** Этапы, по которым в файле есть строки-итоги (см. `isStageTotalRow`). */
  totalStageIds: string[];
}

/**
 * Строка-итог этапа: без id, даты и автора (старый формат `этап;часы[;начало;
 * окончание]`). Такая строка означает «факт этапа = N», а не «ещё N часов».
 */
export function isStageTotalRow(row: ActualsCsvRow): boolean {
  return !row.id?.trim() && !row.date?.trim() && !row.author?.trim();
}

/**
 * Как импорт обходится с ручными часами этапа (базовая запись, в т.ч.
 * перенесённая миграцией, и поправка):
 * - `replace` — данные источника заменяют ручные часы (ручные даты остаются);
 * - `add` — данные источника добавляются к ручным часам;
 * - `auto` — `replace` для этапов со строками-итогами, `add` для worklog.
 */
export type ManualHoursMode = 'auto' | 'replace' | 'add';
export const MANUAL_HOURS_MODES: readonly ManualHoursMode[] = ['auto', 'replace', 'add'];

export function manualHoursRule(
  mode: ManualHoursMode,
  stageHasTotalRows: boolean,
): 'replace' | 'add' {
  if (mode !== 'auto') return mode;
  return stageHasTotalRows ? 'replace' : 'add';
}

/**
 * Превращает строки CSV в записи журнала. Этап ищется по сопоставлению
 * задачи (`taskMappings`: ключ задачи → stageId), затем по имени этапа без
 * учёта регистра и пробелов. Строки без явного id с одинаковым ключом
 * (задача/этап, дата, автор) суммируются: это одна запись источника.
 */
export function csvToLedgerEntries(
  rows: ActualsCsvRow[],
  stages: CsvStage[],
  taskMappings: Record<string, string> = {},
): CsvLedgerResult {
  const own = stages.filter((s) => !s.isApprovalTask);
  const byId = new Map(own.map((s) => [s.id, s]));
  const byName = new Map<string, CsvStage[]>();
  for (const s of own) byName.set(norm(s.name), [...(byName.get(norm(s.name)) ?? []), s]);
  const mapping = new Map(Object.entries(taskMappings).map(([k, v]) => [norm(k), v]));

  const result: CsvLedgerResult = {
    entries: [],
    matched: [],
    allExternalIds: [],
    unmatched: [],
    ambiguous: [],
    unmappedTasks: [],
    duplicateIds: [],
    totalStageIds: [],
  };
  const merged = new Map<
    string,
    { entry: LedgerEntryInput; stage: CsvStage; row: ActualsCsvRow }
  >();
  const explicitSeen = new Set<string>();

  for (const row of rows) {
    const externalId = csvExternalId(row);
    if (!result.allExternalIds.includes(externalId)) result.allExternalIds.push(externalId);
    let stage: CsvStage | undefined;
    const task = row.task?.trim();
    if (task && mapping.has(norm(task))) stage = byId.get(mapping.get(norm(task)) as string);
    if (!stage && row.stage) {
      const list = byName.get(norm(row.stage)) ?? [];
      if (list.length > 1) {
        if (!result.ambiguous.includes(row.stage)) result.ambiguous.push(row.stage);
        continue;
      }
      stage = list[0];
    }
    if (!stage) {
      if (task) {
        if (!result.unmappedTasks.includes(task)) result.unmappedTasks.push(task);
      } else if (!result.unmatched.includes(row.stage)) result.unmatched.push(row.stage);
      continue;
    }
    if (isStageTotalRow(row) && !result.totalStageIds.includes(stage.id)) {
      result.totalStageIds.push(stage.id);
    }
    const date = parseDay(row.date);
    const entry: LedgerEntryInput = {
      externalId,
      stageId: stage.id,
      externalTaskKey: task || null,
      author: row.author?.trim() || null,
      hours: row.hours,
      startDate: parseDay(row.start) ?? date,
      endDate: parseDay(row.end) ?? date,
    };
    const prev = merged.get(externalId);
    if (prev && row.id?.trim()) {
      if (!explicitSeen.has(externalId)) result.duplicateIds.push(row.id.trim());
      explicitSeen.add(externalId);
      merged.set(externalId, { entry, stage, row });
    } else if (prev) {
      const a = prev.entry;
      a.hours = round2((a.hours ?? 0) + row.hours);
      if (entry.startDate && (!a.startDate || entry.startDate < a.startDate))
        a.startDate = entry.startDate;
      if (entry.endDate && (!a.endDate || entry.endDate > a.endDate)) a.endDate = entry.endDate;
    } else {
      merged.set(externalId, { entry, stage, row });
    }
  }

  for (const { entry, stage, row } of merged.values()) {
    result.entries.push(entry);
    result.matched.push({
      externalId: entry.externalId,
      stageId: stage.id,
      name: stage.name,
      hours: entry.hours ?? 0,
      ...(row.task ? { task: row.task } : {}),
      ...(row.start ? { start: row.start } : {}),
      ...(row.end ? { end: row.end } : {}),
    });
  }
  return result;
}
