/**
 * Контракт коннектора к трекеру задач (#103 WP-6a). Конкретный трекер ещё не
 * выбран — здесь только интерфейс и общая часть: превращение worklog в записи
 * журнала факта и прогон синхронизации через `syncLedgerSource`.
 *
 * Адаптер реализует `fetchWorklogs`: отдаёт записи трудозатрат, изменённые с
 * курсора, и новый курсор. Всё остальное — идемпотентность, исправления,
 * удаления, агрегат по этапам, журнал прогонов — общее для всех трекеров.
 */
import { isValidSource, type LedgerEntryInput, type SyncMode } from '@/lib/actualsLedger';
import type { LedgerSyncInput, LedgerSyncResult } from '@/lib/actualsLedgerData';

const MAX_KEY = 200;

/** Одна запись трудозатрат во внешнем трекере. */
export interface TrackerWorklog {
  /** Стабильный id записи в трекере — ключ идемпотентности. */
  id: string;
  /** Ключ задачи (например, `PRJ-123`), сопоставляется с этапом. */
  taskKey: string;
  author?: string | null;
  hours: number;
  /** Дата работы; для записи-интервала — начало. */
  startedAt: Date;
  endedAt?: Date | null;
  /** Время последней правки записи в трекере. */
  updatedAt?: Date | null;
}

export interface TrackerFetchParams {
  /** Внешний проект/фильтр, к которому привязан расчёт. */
  scope: string;
  /** Курсор прошлой синхронизации; null — полная выгрузка. */
  cursor: string | null;
  signal?: AbortSignal;
}

export interface TrackerFetchResult {
  worklogs: TrackerWorklog[];
  /** Курсор для следующего инкрементального прогона. */
  nextCursor: string | null;
  /**
   * true — выгружен полный набор записей scope (а не дельта с курсора), и
   * пропавшие записи можно помечать удалёнными.
   */
  complete: boolean;
}

export interface TrackerConnector {
  /** Значение `ActualEntry.source`: `[a-z][a-z0-9_-]*`, не 'csv' и не 'manual'. */
  readonly source: string;
  readonly label: string;
  fetchWorklogs(params: TrackerFetchParams): Promise<TrackerFetchResult>;
}

export interface WorklogConversion {
  entries: LedgerEntryInput[];
  /** Ключи задач без сопоставления с этапом. */
  unmappedTasks: string[];
  errors: string[];
}

/**
 * worklog → записи журнала. Несопоставленные задачи записываются без этапа
 * (stageId = null): они не попадают в агрегат, но и не теряются — после
 * сопоставления следующий прогон проставит этап.
 */
export function worklogsToEntries(
  worklogs: TrackerWorklog[],
  taskMappings: Record<string, string>,
): WorklogConversion {
  const out: WorklogConversion = { entries: [], unmappedTasks: [], errors: [] };
  for (const w of worklogs) {
    if (!w.id || !Number.isFinite(w.hours) || w.hours < 0) {
      out.errors.push(`Некорректная запись ${w.id || '(без id)'}: ${w.taskKey}`);
      continue;
    }
    // Ограничения столбцов (CHECK в миграции): одна такая запись отклоняется,
    // а не роняет всю синхронизацию.
    if (w.id.length > MAX_KEY || !w.taskKey || w.taskKey.length > MAX_KEY) {
      out.errors.push(`Слишком длинный id или ключ задачи: ${w.id.slice(0, 40)}…`);
      continue;
    }
    const stageId = taskMappings[w.taskKey] ?? null;
    if (!stageId && !out.unmappedTasks.includes(w.taskKey)) out.unmappedTasks.push(w.taskKey);
    out.entries.push({
      externalId: w.id,
      stageId,
      externalTaskKey: w.taskKey,
      author: w.author ?? null,
      hours: Math.round(w.hours * 100) / 100,
      startDate: w.startedAt,
      endDate: w.endedAt ?? w.startedAt,
      externalUpdatedAt: w.updatedAt ?? null,
    });
  }
  return out;
}

export interface TrackerSyncDeps {
  sync: (input: LedgerSyncInput) => Promise<LedgerSyncResult>;
  loadMappings: (calculationId: string, source: string) => Promise<Record<string, string>>;
}

/**
 * Прогон синхронизации расчёта с трекером. Режим `full` — только если
 * коннектор отдал полный набор (`complete`): иначе пропавшая из дельты
 * запись была бы ошибочно удалена.
 */
export async function runTrackerSync(
  connector: TrackerConnector,
  params: {
    calculationId: string;
    scope: string;
    cursor: string | null;
    startedBy: string | null;
    dryRun?: boolean;
  },
  deps?: TrackerSyncDeps,
): Promise<LedgerSyncResult & { unmappedTasks: string[]; nextCursor: string | null }> {
  if (!isValidSource(connector.source) || ['csv', 'manual'].includes(connector.source)) {
    throw new Error(`Недопустимый source коннектора: ${connector.source}`);
  }
  const d = deps ?? (await defaultDeps());
  const fetched = await connector.fetchWorklogs({ scope: params.scope, cursor: params.cursor });
  const mappings = await d.loadMappings(params.calculationId, connector.source);
  const conv = worklogsToEntries(fetched.worklogs, mappings);
  const mode: SyncMode = fetched.complete ? 'full' : 'incremental';
  const result = await d.sync({
    calculationId: params.calculationId,
    source: connector.source,
    entries: conv.entries,
    mode,
    startedBy: params.startedBy,
    cursor: fetched.nextCursor,
    errors: conv.errors,
    dryRun: params.dryRun,
  });
  return { ...result, unmappedTasks: conv.unmappedTasks, nextCursor: fetched.nextCursor };
}

async function defaultDeps(): Promise<TrackerSyncDeps> {
  const data = await import('@/lib/actualsLedgerData');
  return { sync: data.syncLedgerSource, loadMappings: data.loadTaskMappings };
}
