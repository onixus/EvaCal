/**
 * Отклонения по одинаковым задачам (Horizon E3): чистая логика без Prisma.
 *
 * Одна и та же задача («Установка агентов») встречается во многих проектах.
 * Норматив может не зависеть от объёма (5 минут на агент), поэтому сравнивается
 * не абсолют, а отношение факт / план по этапу. По задаче считается медиана
 * отклонений: устойчиво к выбросам и говорит, систематически ли норматив
 * промахивается. Конструктор собирает срезы по выбранным задачам, фильтрам и
 * группировке. Загрузка данных — в `lib/deviationsData.ts`.
 */

export interface DeviationRow {
  calculationId: string;
  calculationName: string;
  customer: string;
  templateName: string | null;
  architect: string | null;
  /** Дата исхода сделки; по ней период. */
  closedAt: Date | null;
  stageId: string;
  task: string;
  role: string;
  plannedHours: number;
  actualHours: number;
  /** Плановая/фактическая длительность, дней; null — дат факта нет. */
  plannedDays: number | null;
  actualDays: number | null;
}

/** Ключ задачи: без регистра, лишних пробелов и номера в начале («1. Установка» = «Установка»). */
export function taskKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/^\s*[\d.]+\s*[).:-]?\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function deviationOf(row: { plannedHours: number; actualHours: number }): number | null {
  if (row.plannedHours <= 0) return null;
  return Math.round((row.actualHours / row.plannedHours - 1) * 100) / 100;
}

export interface TaskCatalogEntry {
  key: string;
  /** Самое частое написание. */
  label: string;
  samples: number;
  roles: string[];
  medianDeviation: number | null;
}

export function taskCatalog(rows: DeviationRow[]): TaskCatalogEntry[] {
  type Acc = { labels: Map<string, number>; devs: number[]; roles: Set<string> };
  const byKey = new Map<string, Acc>();
  for (const r of rows) {
    const k = taskKey(r.task);
    if (!k) continue;
    const acc: Acc = byKey.get(k) ?? { labels: new Map(), devs: [], roles: new Set() };
    acc.labels.set(r.task.trim(), (acc.labels.get(r.task.trim()) ?? 0) + 1);
    const d = deviationOf(r);
    if (d !== null) acc.devs.push(d);
    acc.roles.add(r.role);
    byKey.set(k, acc);
  }
  return [...byKey.entries()]
    .map(([key, acc]) => ({
      key,
      label: [...acc.labels.entries()].sort((a, b) => b[1] - a[1])[0][0],
      samples: acc.devs.length,
      roles: [...acc.roles].sort(),
      medianDeviation: round2(median(acc.devs)),
    }))
    .sort((a, b) => b.samples - a.samples || a.label.localeCompare(b.label, 'ru'));
}

// ---------------------------------------------------------------------------
// Конструктор
// ---------------------------------------------------------------------------

export type GroupBy =
  'task' | 'role' | 'template' | 'architect' | 'customer' | 'month' | 'calculation';
export type Metric = 'median' | 'mean' | 'p90';
export type DeviationKind = 'hours' | 'days';

export interface DeviationReportConfig {
  /** Ключи задач (taskKey). Пусто — все задачи. */
  tasks: string[];
  roles?: string[];
  templates?: string[];
  architects?: string[];
  customers?: string[];
  /** Период по дате исхода сделки, ISO-даты. */
  from?: string | null;
  to?: string | null;
  groupBy: GroupBy;
  metric: Metric;
  /** Что сравниваем: часы или календарные дни. */
  kind?: DeviationKind;
  /** Меньше — группа помечается «мало данных». */
  minSamples?: number;
  /** Порог отклонения (доля), за которым строка считается перерасходом/недорасходом. */
  tolerance?: number;
}

export const GROUP_LABELS: Record<GroupBy, string> = {
  task: 'Задача',
  role: 'Роль',
  template: 'Шаблон',
  architect: 'Архитектор',
  customer: 'Заказчик',
  month: 'Месяц исхода',
  calculation: 'Расчёт',
};

export const METRIC_LABELS: Record<Metric, string> = {
  median: 'Медиана',
  mean: 'Среднее',
  p90: '90-й перцентиль',
};

export const DEFAULT_TOLERANCE = 0.1;
export const DEFAULT_MIN_SAMPLES = 3;

export interface DeviationGroup {
  key: string;
  label: string;
  samples: number;
  /** Выбранная метрика отклонения (доля, +0.2 = перерасход 20%). */
  value: number | null;
  median: number | null;
  mean: number | null;
  p90: number | null;
  min: number | null;
  max: number | null;
  /** Сколько наблюдений вышли за допуск вверх / вниз / в допуске. */
  over: number;
  under: number;
  within: number;
  plannedTotal: number;
  actualTotal: number;
  lowSample: boolean;
}

export interface DeviationReportResult {
  config: DeviationReportConfig;
  rowsTotal: number;
  rowsUsed: number;
  groups: DeviationGroup[];
  /** Итог по всем строкам среза. */
  overall: Omit<DeviationGroup, 'key' | 'label'>;
}

function round2(n: number | null): number | null {
  return n === null ? null : Math.round(n * 100) / 100;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1));
  return s[idx];
}

function monthOf(d: Date | null): string | null {
  if (!d) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function groupKeyOf(r: DeviationRow, by: GroupBy): { key: string; label: string } | null {
  switch (by) {
    case 'task':
      return { key: taskKey(r.task), label: r.task.trim() };
    case 'role':
      return { key: r.role, label: r.role };
    case 'template':
      return r.templateName ? { key: r.templateName, label: r.templateName } : null;
    case 'architect':
      return r.architect ? { key: r.architect, label: r.architect } : null;
    case 'customer':
      return { key: r.customer, label: r.customer };
    case 'month': {
      const m = monthOf(r.closedAt);
      return m ? { key: m, label: m } : null;
    }
    case 'calculation':
      return { key: r.calculationId, label: r.calculationName };
  }
}

export function filterRows(rows: DeviationRow[], cfg: DeviationReportConfig): DeviationRow[] {
  const tasks = new Set(cfg.tasks.map(taskKey).filter(Boolean));
  const from = cfg.from ? new Date(cfg.from) : null;
  const to = cfg.to ? new Date(cfg.to) : null;
  return rows.filter((r) => {
    if (tasks.size > 0 && !tasks.has(taskKey(r.task))) return false;
    if (cfg.roles?.length && !cfg.roles.includes(r.role)) return false;
    if (cfg.templates?.length && (!r.templateName || !cfg.templates.includes(r.templateName)))
      return false;
    if (cfg.architects?.length && (!r.architect || !cfg.architects.includes(r.architect)))
      return false;
    if (cfg.customers?.length && !cfg.customers.includes(r.customer)) return false;
    if (from && (!r.closedAt || r.closedAt < from)) return false;
    if (to && (!r.closedAt || r.closedAt > to)) return false;
    return true;
  });
}

function observation(
  r: DeviationRow,
  kind: DeviationKind,
): { planned: number; actual: number } | null {
  if (kind === 'days') {
    if (r.plannedDays === null || r.actualDays === null || r.plannedDays <= 0) return null;
    return { planned: r.plannedDays, actual: r.actualDays };
  }
  if (r.plannedHours <= 0) return null;
  return { planned: r.plannedHours, actual: r.actualHours };
}

function summarize(obs: { planned: number; actual: number }[], cfg: DeviationReportConfig) {
  const tol = cfg.tolerance ?? DEFAULT_TOLERANCE;
  const minSamples = cfg.minSamples ?? DEFAULT_MIN_SAMPLES;
  const devs = obs.map((o) => o.actual / o.planned - 1);
  const med = median(devs);
  const mean = devs.length ? devs.reduce((s, d) => s + d, 0) / devs.length : null;
  const p90 = percentile(devs, 0.9);
  const value = cfg.metric === 'mean' ? mean : cfg.metric === 'p90' ? p90 : med;
  return {
    samples: devs.length,
    value: round2(value),
    median: round2(med),
    mean: round2(mean),
    p90: round2(p90),
    min: round2(devs.length ? Math.min(...devs) : null),
    max: round2(devs.length ? Math.max(...devs) : null),
    over: devs.filter((d) => d > tol).length,
    under: devs.filter((d) => d < -tol).length,
    within: devs.filter((d) => Math.abs(d) <= tol).length,
    plannedTotal: Math.round(obs.reduce((s, o) => s + o.planned, 0) * 10) / 10,
    actualTotal: Math.round(obs.reduce((s, o) => s + o.actual, 0) * 10) / 10,
    lowSample: devs.length < minSamples,
  };
}

export function buildDeviationReport(
  rows: DeviationRow[],
  cfg: DeviationReportConfig,
): DeviationReportResult {
  const kind = cfg.kind ?? 'hours';
  const filtered = filterRows(rows, cfg);
  const groups = new Map<string, { label: string; obs: { planned: number; actual: number }[] }>();
  const allObs: { planned: number; actual: number }[] = [];
  for (const r of filtered) {
    const o = observation(r, kind);
    if (!o) continue;
    const g = groupKeyOf(r, cfg.groupBy);
    if (!g) continue;
    allObs.push(o);
    const acc = groups.get(g.key) ?? { label: g.label, obs: [] };
    acc.obs.push(o);
    groups.set(g.key, acc);
  }
  const result: DeviationGroup[] = [...groups.entries()]
    .map(([key, g]) => ({ key, label: g.label, ...summarize(g.obs, cfg) }))
    .sort((a, b) => {
      if (cfg.groupBy === 'month') return a.key.localeCompare(b.key);
      return Math.abs(b.value ?? 0) - Math.abs(a.value ?? 0) || b.samples - a.samples;
    });
  return {
    config: { ...cfg, kind },
    rowsTotal: rows.length,
    rowsUsed: allObs.length,
    groups: result,
    overall: summarize(allObs, cfg),
  };
}

/** Проверка конфигурации из запроса: неизвестные значения заменяются на допустимые. */
export function normalizeConfig(raw: unknown): DeviationReportConfig {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const strs = (v: unknown): string[] | undefined =>
    Array.isArray(v)
      ? v
          .map(String)
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
  const date = (v: unknown): string | null => {
    if (typeof v !== 'string' || !v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : v;
  };
  const groupBy = (Object.keys(GROUP_LABELS) as GroupBy[]).includes(o.groupBy as GroupBy)
    ? (o.groupBy as GroupBy)
    : 'task';
  const metric = (Object.keys(METRIC_LABELS) as Metric[]).includes(o.metric as Metric)
    ? (o.metric as Metric)
    : 'median';
  const minSamples = Number(o.minSamples);
  const tolerance = Number(o.tolerance);
  return {
    tasks: strs(o.tasks) ?? [],
    roles: strs(o.roles),
    templates: strs(o.templates),
    architects: strs(o.architects),
    customers: strs(o.customers),
    from: date(o.from),
    to: date(o.to),
    groupBy,
    metric,
    kind: o.kind === 'days' ? 'days' : 'hours',
    minSamples:
      Number.isFinite(minSamples) && minSamples >= 1 ? Math.floor(minSamples) : DEFAULT_MIN_SAMPLES,
    tolerance:
      Number.isFinite(tolerance) && tolerance >= 0 && tolerance <= 1
        ? tolerance
        : DEFAULT_TOLERANCE,
  };
}
