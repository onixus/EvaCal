/**
 * Факт и исход сделки (Horizon E1): чистая логика без Prisma.
 *
 * Исход живёт на проекте (сделка одна, версий расчёта много), факт часов — на
 * этапах выигранной версии. Здесь: допустимые переходы исхода, точность
 * оценки, фактическая маржа, win rate и связь скидки с исходом. Загрузка
 * данных — в `lib/actualsData.ts`.
 */
import {
  DEFAULT_ROLE_RATES,
  calculateCommercialSummary,
  resolveRoleRates,
  type CommercialConfig,
} from './commercial';
import { median, round1, round2 } from './stats';

// ---------------------------------------------------------------------------
// Справочники
// ---------------------------------------------------------------------------

export type DealStatus = 'open' | 'won' | 'lost' | 'cancelled';
export const DEAL_STATUSES: readonly DealStatus[] = ['open', 'won', 'lost', 'cancelled'];

export const DEAL_STATUS_LABELS: Record<DealStatus, string> = {
  open: 'Открыта',
  won: 'Выиграна',
  lost: 'Проиграна',
  cancelled: 'Отменена',
};

export type LossReason =
  'price' | 'competitor' | 'timing' | 'no_budget' | 'scope' | 'relationship' | 'other';

export const LOSS_REASONS: { value: LossReason; label: string }[] = [
  { value: 'price', label: 'Цена' },
  { value: 'competitor', label: 'Ушли к конкуренту' },
  { value: 'timing', label: 'Сроки' },
  { value: 'no_budget', label: 'Нет бюджета / закупка не состоялась' },
  { value: 'scope', label: 'Не сошлись по объёму работ' },
  { value: 'relationship', label: 'Отношения / политика заказчика' },
  { value: 'other', label: 'Другое' },
];

export function isDealStatus(v: unknown): v is DealStatus {
  return typeof v === 'string' && (DEAL_STATUSES as readonly string[]).includes(v);
}

export function isLossReason(v: unknown): v is LossReason {
  return typeof v === 'string' && LOSS_REASONS.some((r) => r.value === v);
}

export function lossReasonLabel(v: string | null | undefined): string {
  return LOSS_REASONS.find((r) => r.value === v)?.label ?? v ?? '—';
}

// ---------------------------------------------------------------------------
// Переходы исхода
// ---------------------------------------------------------------------------

export interface DealInput {
  dealStatus: DealStatus;
  wonCalculationId?: string | null;
  contractAmount?: number | null;
  contractCurrency?: string | null;
  lossReason?: string | null;
  lossComment?: string | null;
  competitor?: string | null;
}

export interface DealProjectRow {
  dealStatus: string;
  actualsClosedAt: Date | null;
  wonCalculationId?: string | null;
  /** По текущей выигранной версии уже внесён факт (часы или даты). */
  hasActuals?: boolean;
  contractAmount?: number | null;
  contractCurrency?: string | null;
  calculations: { id: string; status: string; currency: string }[];
}

export interface DealResolution {
  dealStatus: DealStatus;
  dealClosedAt: Date | null;
  wonCalculationId: string | null;
  contractAmount: number | null;
  contractCurrency: string | null;
  lossReason: LossReason | null;
  lossComment: string | null;
  competitor: string | null;
}

/**
 * Проверяет исход и возвращает поля для записи или текст ошибки.
 *
 * Выиграть можно только проект с утверждённым расчётом: без него нечего было
 * подписывать. Проигрыш требует причины — иначе аналитика причин пуста.
 * Возврат в `open` разрешён (сделка переоткрыта), но факт при этом не трогаем.
 */
export function resolveDeal(
  project: DealProjectRow,
  input: DealInput,
  now: Date = new Date(),
): { ok: true; data: DealResolution } | { ok: false; error: string; status: number } {
  if (!isDealStatus(input.dealStatus)) {
    return { ok: false, error: 'Недопустимый статус сделки', status: 400 };
  }
  // Закрытый факт замораживает исход целиком, включая повторное «выиграно»:
  // иначе можно было бы перенести выигранную версию и оставить факт за бортом.
  if (project.actualsClosedAt) {
    return {
      ok: false,
      error: 'Факт по проекту закрыт: сначала переоткройте факт, потом меняйте исход',
      status: 409,
    };
  }

  const base: DealResolution = {
    dealStatus: input.dealStatus,
    dealClosedAt: input.dealStatus === 'open' ? null : now,
    wonCalculationId: null,
    contractAmount: null,
    contractCurrency: null,
    lossReason: null,
    lossComment: null,
    competitor: null,
  };

  switch (input.dealStatus) {
    case 'open':
      return { ok: true, data: base };
    case 'won': {
      const approved = project.calculations.filter((c) => c.status === 'approved');
      if (approved.length === 0) {
        return {
          ok: false,
          error: 'Нельзя отметить сделку выигранной без утверждённого расчёта',
          status: 409,
        };
      }
      const wonId = input.wonCalculationId ?? (approved.length === 1 ? approved[0].id : null);
      const won = approved.find((c) => c.id === wonId);
      if (!won) {
        return {
          ok: false,
          error: 'Укажите утверждённую версию расчёта, по которой подписан договор',
          status: 400,
        };
      }
      // Смена выигранной версии при внесённом факте оставила бы факт за
      // бортом: он привязан к wonCalculationId.
      if (
        project.dealStatus === 'won' &&
        project.wonCalculationId &&
        project.wonCalculationId !== won.id &&
        project.hasActuals
      ) {
        return {
          ok: false,
          error: 'По текущей выигранной версии уже внесён факт: сначала удалите или перенесите его',
          status: 409,
        };
      }
      // Не переданная сумма — не «обнулить», а «оставить как было».
      const amount =
        input.contractAmount === undefined
          ? project.dealStatus === 'won'
            ? (project.contractAmount ?? null)
            : null
          : input.contractAmount === null
            ? null
            : Number(input.contractAmount);
      if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
        return {
          ok: false,
          error: 'Сумма договора должна быть неотрицательным числом',
          status: 400,
        };
      }
      return {
        ok: true,
        data: {
          ...base,
          wonCalculationId: won.id,
          contractAmount: amount,
          contractCurrency:
            amount === null
              ? null
              : input.contractCurrency?.trim() ||
                (input.contractAmount === undefined ? project.contractCurrency : null) ||
                won.currency,
          competitor: input.competitor?.trim() || null,
        },
      };
    }
    case 'lost': {
      if (!isLossReason(input.lossReason)) {
        return { ok: false, error: 'Укажите причину проигрыша', status: 400 };
      }
      return {
        ok: true,
        data: {
          ...base,
          lossReason: input.lossReason,
          lossComment: input.lossComment?.trim() || null,
          competitor: input.competitor?.trim() || null,
        },
      };
    }
    case 'cancelled':
      return { ok: true, data: { ...base, lossComment: input.lossComment?.trim() || null } };
  }
}

// ---------------------------------------------------------------------------
// Точность оценки
// ---------------------------------------------------------------------------

export interface ActualStageRow {
  name: string;
  role: string;
  hours: number;
  isApprovalTask: boolean;
  actualHours: number | null;
}

export interface StageAccuracy {
  name: string;
  role: string;
  plannedHours: number;
  actualHours: number | null;
  /** actual / planned; null — факта нет или план 0. */
  ratio: number | null;
  /** ratio − 1; положительное — потратили больше плана. */
  deviation: number | null;
}

export interface CalculationAccuracy {
  stages: StageAccuracy[];
  /** Этапов с внесённым фактом / всего рабочих этапов. */
  covered: number;
  total: number;
  /** Сумма плана только по этапам с фактом — сравнение честное. */
  plannedCovered: number;
  actualCovered: number;
  ratio: number | null;
  deviation: number | null;
  /** Полнота: факт есть по всем этапам. */
  complete: boolean;
}

export function stageAccuracy(stage: ActualStageRow): StageAccuracy {
  const ratio =
    stage.actualHours === null || stage.hours <= 0 ? null : round2(stage.actualHours / stage.hours);
  return {
    name: stage.name,
    role: stage.role,
    plannedHours: stage.hours,
    actualHours: stage.actualHours,
    ratio,
    deviation: ratio === null ? null : round2(ratio - 1),
  };
}

/**
 * Точность расчёта. Этапы без факта не входят в знаменатель: иначе
 * наполовину внесённый факт выглядел бы как «сделали вдвое быстрее».
 */
export function calculationAccuracy(stages: ActualStageRow[]): CalculationAccuracy {
  const work = stages.filter((s) => !s.isApprovalTask);
  const rows = work.map(stageAccuracy);
  const withActual = rows.filter((r) => r.actualHours !== null);
  const plannedCovered = round1(withActual.reduce((s, r) => s + r.plannedHours, 0));
  const actualCovered = round1(withActual.reduce((s, r) => s + (r.actualHours ?? 0), 0));
  const ratio = plannedCovered > 0 ? round2(actualCovered / plannedCovered) : null;
  return {
    stages: rows,
    covered: withActual.length,
    total: work.length,
    plannedCovered,
    actualCovered,
    ratio,
    deviation: ratio === null ? null : round2(ratio - 1),
    complete: work.length > 0 && withActual.length === work.length,
  };
}

/** Цветовая зона отклонения: ±10% — норма, ±25% — предупреждение, дальше — промах. */
export type AccuracyTone = 'ok' | 'warn' | 'bad' | 'none';
export function accuracyTone(deviation: number | null): AccuracyTone {
  if (deviation === null) return 'none';
  const abs = Math.abs(deviation);
  if (abs <= 0.1) return 'ok';
  if (abs <= 0.25) return 'warn';
  return 'bad';
}

// ---------------------------------------------------------------------------
// Фактическая маржа
// ---------------------------------------------------------------------------

export interface ActualMarginInput {
  stages: ActualStageRow[];
  actualPmHours: number | null;
  roleRates: string | Record<string, number> | null | undefined;
  overheadPercent: number;
  contractAmount: number | null;
}

export interface ActualMargin {
  /** Себестоимость по факту с оверхедом; считается только по этапам с фактом. */
  actualCost: number;
  /** Часов факта, вошедших в себестоимость. */
  actualHours: number;
  contractAmount: number | null;
  /** (сумма − себестоимость) / сумма; null — суммы нет. */
  margin: number | null;
  /** Факт внесён не по всем этапам — маржа завышена. */
  partial: boolean;
}

export function actualMargin(input: ActualMarginInput): ActualMargin {
  const rates = resolveRoleRates(input.roleRates ?? null);
  const work = input.stages.filter((s) => !s.isApprovalTask);
  let hours = 0;
  let cost = 0;
  for (const s of work) {
    if (s.actualHours === null) continue;
    hours += s.actualHours;
    cost += s.actualHours * (rates[s.role] ?? DEFAULT_ROLE_RATES.other);
  }
  if (input.actualPmHours !== null) {
    hours += input.actualPmHours;
    cost += input.actualPmHours * (rates.pm ?? DEFAULT_ROLE_RATES.pm);
  }
  const actualCost = Math.round(cost * (1 + (input.overheadPercent || 0) / 100));
  const amount = input.contractAmount;
  const margin = amount && amount > 0 ? round2((amount - actualCost) / amount) : null;
  return {
    actualCost,
    actualHours: round1(hours),
    contractAmount: amount,
    margin,
    partial: work.some((s) => s.actualHours === null),
  };
}

// ---------------------------------------------------------------------------
// Аналитика сделок
// ---------------------------------------------------------------------------

export interface DealRow {
  id: string;
  dealStatus: string;
  dealClosedAt: Date | null;
  lossReason: string | null;
  createdBy: string;
  /** Скидка выигранной/последней утверждённой версии, %. */
  discountPercent: number | null;
  templateName: string | null;
}

/** Меньше стольких сделок в группе — «мало данных». */
export const MIN_DEALS = 5;

export interface WinRate {
  won: number;
  lost: number;
  cancelled: number;
  open: number;
  /** won / (won + lost); null — решённых нет. */
  rate: number | null;
  lowSample: boolean;
}

export function winRate(rows: DealRow[]): WinRate {
  const count = (s: string) => rows.filter((r) => r.dealStatus === s).length;
  const won = count('won');
  const lost = count('lost');
  const decided = won + lost;
  return {
    won,
    lost,
    cancelled: count('cancelled'),
    open: count('open'),
    rate: decided ? round2(won / decided) : null,
    lowSample: decided < MIN_DEALS,
  };
}

export const DISCOUNT_BUCKETS: { key: string; label: string; min: number; max: number }[] = [
  { key: '0', label: 'Без скидки', min: 0, max: 0 },
  { key: '1-5', label: '1–5%', min: 0.000001, max: 5 },
  { key: '6-10', label: '6–10%', min: 5.000001, max: 10 },
  { key: '11-20', label: '11–20%', min: 10.000001, max: 20 },
  { key: '20+', label: 'Более 20%', min: 20.000001, max: Infinity },
];

export function discountBucket(discountPercent: number | null): string | null {
  if (discountPercent === null || !Number.isFinite(discountPercent)) return null;
  const d = Math.max(0, discountPercent);
  return DISCOUNT_BUCKETS.find((b) => d >= b.min && d <= b.max)?.key ?? null;
}

export interface DiscountOutcome {
  key: string;
  label: string;
  winRate: WinRate;
}

/** Связь скидки с исходом: по бакетам скидки считается win rate решённых сделок. */
export function discountOutcomes(rows: DealRow[]): DiscountOutcome[] {
  return DISCOUNT_BUCKETS.map((b) => ({
    key: b.key,
    label: b.label,
    winRate: winRate(rows.filter((r) => discountBucket(r.discountPercent) === b.key)),
  }));
}

export interface LossReasonShare {
  reason: string;
  label: string;
  count: number;
  share: number;
}

export function lossReasons(rows: DealRow[]): LossReasonShare[] {
  const lost = rows.filter((r) => r.dealStatus === 'lost');
  const counts = new Map<string, number>();
  for (const r of lost) {
    const key = r.lossReason ?? 'other';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({
      reason,
      label: lossReasonLabel(reason),
      count,
      share: lost.length ? round2(count / lost.length) : 0,
    }))
    .sort((a, b) => b.count - a.count);
}

export interface MonthlyWin {
  month: string; // YYYY-MM
  won: number;
  lost: number;
  rate: number | null;
}

export function monthlyWins(rows: DealRow[]): MonthlyWin[] {
  const byMonth = new Map<string, { won: number; lost: number }>();
  for (const r of rows) {
    if (!r.dealClosedAt || (r.dealStatus !== 'won' && r.dealStatus !== 'lost')) continue;
    const d = r.dealClosedAt;
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const acc = byMonth.get(key) ?? { won: 0, lost: 0 };
    if (r.dealStatus === 'won') acc.won += 1;
    else acc.lost += 1;
    byMonth.set(key, acc);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({
      month,
      ...v,
      rate: v.won + v.lost ? round2(v.won / (v.won + v.lost)) : null,
    }));
}

/** Win rate по группам (шаблон, автор). */
export function winRateBy(
  rows: DealRow[],
  key: (r: DealRow) => string | null,
): { group: string; winRate: WinRate }[] {
  const groups = new Map<string, DealRow[]>();
  for (const r of rows) {
    const g = key(r);
    if (!g) continue;
    groups.set(g, [...(groups.get(g) ?? []), r]);
  }
  return [...groups.entries()]
    .map(([group, list]) => ({ group, winRate: winRate(list) }))
    .sort((a, b) => (b.winRate.rate ?? -1) - (a.winRate.rate ?? -1));
}

// ---------------------------------------------------------------------------
// Аналитика точности
// ---------------------------------------------------------------------------

export interface AccuracyCalcRow {
  id: string;
  name: string;
  templateName: string | null;
  /** Кто утвердил/вёл расчёт как архитектор (по журналу) или создатель. */
  architect: string | null;
  closedAt: Date | null;
  stages: ActualStageRow[];
}

export interface AccuracyPoint {
  id: string;
  name: string;
  templateName: string | null;
  architect: string | null;
  planned: number;
  actual: number;
  ratio: number | null;
  deviation: number | null;
  complete: boolean;
}

export interface RoleBias {
  role: string;
  samples: number;
  /** Медиана отклонения по этапам роли; > 0 — недооцениваем. */
  medianDeviation: number | null;
  lowSample: boolean;
}

export interface GroupAccuracy {
  group: string;
  samples: number;
  /** Медиана |отклонения| по расчётам группы. */
  medianAbsDeviation: number | null;
  /** Медиана отклонения со знаком. */
  medianDeviation: number | null;
  lowSample: boolean;
}

export function accuracyPoints(rows: AccuracyCalcRow[]): AccuracyPoint[] {
  return rows
    .map((r) => {
      const acc = calculationAccuracy(r.stages);
      return {
        id: r.id,
        name: r.name,
        templateName: r.templateName,
        architect: r.architect,
        planned: acc.plannedCovered,
        actual: acc.actualCovered,
        ratio: acc.ratio,
        deviation: acc.deviation,
        complete: acc.complete,
      };
    })
    .filter((p) => p.ratio !== null);
}

export function roleBias(rows: AccuracyCalcRow[]): RoleBias[] {
  const byRole = new Map<string, number[]>();
  for (const r of rows) {
    for (const s of r.stages) {
      const a = stageAccuracy(s);
      if (a.deviation === null || s.isApprovalTask) continue;
      byRole.set(s.role, [...(byRole.get(s.role) ?? []), a.deviation]);
    }
  }
  return [...byRole.entries()]
    .map(([role, devs]) => {
      const m = median(devs);
      return {
        role,
        samples: devs.length,
        medianDeviation: m === null ? null : round2(m),
        lowSample: devs.length < MIN_DEALS,
      };
    })
    .sort((a, b) => Math.abs(b.medianDeviation ?? 0) - Math.abs(a.medianDeviation ?? 0));
}

export function accuracyBy(
  points: AccuracyPoint[],
  key: (p: AccuracyPoint) => string | null,
): GroupAccuracy[] {
  const groups = new Map<string, number[]>();
  for (const p of points) {
    const g = key(p);
    if (!g || p.deviation === null) continue;
    groups.set(g, [...(groups.get(g) ?? []), p.deviation]);
  }
  return [...groups.entries()]
    .map(([group, devs]) => {
      const abs = median(devs.map(Math.abs));
      const signed = median(devs);
      return {
        group,
        samples: devs.length,
        medianAbsDeviation: abs === null ? null : round2(abs),
        medianDeviation: signed === null ? null : round2(signed),
        lowSample: devs.length < MIN_DEALS,
      };
    })
    .sort((a, b) => (a.medianAbsDeviation ?? 9) - (b.medianAbsDeviation ?? 9));
}

// ---------------------------------------------------------------------------
// CSV-импорт факта
// ---------------------------------------------------------------------------

export interface ActualsCsvRow {
  /** Имя этапа; пустое, если строка привязана к задаче (`task`). */
  stage: string;
  hours: number;
  start?: string;
  end?: string;
  /** Явный идентификатор записи (worklog id) — ключ идемпотентности. */
  id?: string;
  /** Ключ внешней задачи, сопоставляемой с этапом. */
  task?: string;
  /** Дата записи (worklog). */
  date?: string;
  author?: string;
}

export interface ActualsImportResult {
  matched: { stageId: string; name: string; hours: number; start?: string; end?: string }[];
  unmatched: string[];
  invalid: string[];
  /** Имя встречается у нескольких этапов: строку нельзя привязать однозначно. */
  ambiguous: string[];
}

type CsvColumn = 'id' | 'task' | 'stage' | 'hours' | 'date' | 'start' | 'end' | 'author';

const CSV_HEADERS: Record<CsvColumn, string[]> = {
  id: ['id', 'externalid', 'external id', 'worklog', 'worklog id', 'ид', 'идентификатор'],
  task: ['task', 'key', 'issue', 'issue key', 'задача', 'ключ', 'ключ задачи'],
  stage: ['stage', 'этап'],
  hours: ['hours', 'часы', 'spent', 'time spent', 'трудозатраты'],
  date: ['date', 'дата'],
  start: ['start', 'начало'],
  end: ['end', 'окончание', 'конец'],
  author: ['author', 'user', 'автор', 'исполнитель'],
};

function headerColumns(cells: string[]): Partial<Record<CsvColumn, number>> | null {
  const cols: Partial<Record<CsvColumn, number>> = {};
  cells.forEach((c, i) => {
    const k = c.toLowerCase().replace(/\s+/g, ' ').trim();
    for (const [col, names] of Object.entries(CSV_HEADERS) as [CsvColumn, string[]][]) {
      if (cols[col] === undefined && names.includes(k)) cols[col] = i;
    }
  });
  if (cols.hours === undefined || (cols.stage === undefined && cols.task === undefined))
    return null;
  return cols;
}

/**
 * Разбирает CSV факта (разделитель `;` или `,`).
 *
 * Без заголовка — старый позиционный формат `этап;часы[;начало;окончание]`.
 * С заголовком столбцы ищутся по именам: `id`, `задача`/`task`, `этап`/`stage`,
 * `часы`/`hours`, `дата`/`date`, `начало`/`start`, `окончание`/`end`,
 * `автор`/`author` — так выгрузку worklog из трекера можно загрузить как есть.
 * Первая строка без числа во втором столбце, не похожая на заголовок,
 * пропускается, как и раньше.
 */
export function parseActualsCsv(text: string): { rows: ActualsCsvRow[]; invalid: string[] } {
  const rows: ActualsCsvRow[] = [];
  const invalid: string[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  let cols: Partial<Record<CsvColumn, number>> = { stage: 0, hours: 1, start: 2, end: 3 };
  lines.forEach((line, index) => {
    const sep = line.includes(';') ? ';' : ',';
    const cells = line.split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));
    if (index === 0) {
      const header = headerColumns(cells);
      if (header) {
        cols = header;
        return;
      }
    }
    const cell = (c: CsvColumn) => {
      const i = cols[c];
      return i === undefined ? undefined : cells[i] || undefined;
    };
    const hours = Number(String(cell('hours') ?? '').replace(',', '.'));
    const stage = cell('stage') ?? '';
    const task = cell('task');
    if ((!stage && !task) || !Number.isFinite(hours) || cell('hours') === undefined) {
      if (index === 0) return; // заголовок в неизвестном формате
      invalid.push(line);
      return;
    }
    if (hours < 0) {
      invalid.push(line);
      return;
    }
    const row: ActualsCsvRow = { stage, hours, start: cell('start'), end: cell('end') };
    for (const extra of ['id', 'task', 'date', 'author'] as const) {
      const v = cell(extra);
      if (v) row[extra] = v;
    }
    rows.push(row);
  });
  return { rows, invalid };
}

function normName(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function matchActuals(
  rows: ActualsCsvRow[],
  stages: { id: string; name: string; isApprovalTask: boolean }[],
  invalid: string[] = [],
): ActualsImportResult {
  // Имена этапов не уникальны: при совпадении строка помечается неоднозначной,
  // а не пишется в последний попавшийся этап.
  const byName = new Map<string, { id: string; name: string }[]>();
  for (const s of stages) {
    if (s.isApprovalTask) continue;
    const k = normName(s.name);
    byName.set(k, [...(byName.get(k) ?? []), s]);
  }
  const matched: ActualsImportResult['matched'] = [];
  const unmatched: string[] = [];
  const ambiguous: string[] = [];
  for (const r of rows) {
    const list = byName.get(normName(r.stage)) ?? [];
    if (list.length === 0) {
      unmatched.push(r.stage);
      continue;
    }
    if (list.length > 1) {
      ambiguous.push(r.stage);
      continue;
    }
    const s = list[0];
    matched.push({ stageId: s.id, name: s.name, hours: r.hours, start: r.start, end: r.end });
  }
  return { matched, unmatched, invalid, ambiguous };
}

// ---------------------------------------------------------------------------
// Прогноз итоговой прибыли (#103 4.5)
// ---------------------------------------------------------------------------

/** Статусы этапа, после которых оставшейся работы нет. */
export const FINISHED_STAGE_STATUSES = ['done', 'approved'];
/** Статус этапа, по которому работа ещё не начиналась. */
export const NOT_STARTED_STAGE_STATUS = 'planned';

export interface ForecastStageRow {
  id: string;
  name: string;
  role: string;
  hours: number;
  status: string;
  isApprovalTask: boolean;
  /** Агрегат журнала факта; null — факт не вносился. */
  actualHours: number | null;
  /** Подтверждённая оценка остатка; null — не подтверждена. */
  remainingHoursEstimate: number | null;
  /** Факт часов этапа в момент подтверждения оценки (null — факта тогда не было). */
  remainingActualBaseline: number | null;
  remainingEstimatedBy?: string | null;
  remainingEstimatedAt?: Date | string | null;
}

export interface ProfitForecastInput {
  stages: ForecastStageRow[];
  risks: { hours: number }[];
  pmHours: number;
  actualPmHours: number | null;
  remainingPmHoursEstimate: number | null;
  /** Факт часов РП в момент подтверждения оценки остатка РП. */
  remainingPmActualBaseline: number | null;
  remainingPmEstimatedBy?: string | null;
  remainingPmEstimatedAt?: Date | string | null;
  /** Сохранённые условия версии: ставки и проценты берутся только отсюда. */
  terms: CommercialConfig;
  contractAmount: number | null;
  contractCurrency: string | null;
}

/**
 * Состояние строки прогноза:
 * - `known` — факт и актуальный подтверждённый остаток (или этап завершён и факт внесён);
 * - `estimate_only` — работа не начиналась, факта нет, специалист подтвердил весь остаток;
 * - `missing_remaining` — факт есть, остаток не подтверждён;
 * - `missing_actual` — работа начата или завершена, а факт не внесён;
 * - `stale_estimate` — после подтверждения остатка факт изменился: оценку нужно подтвердить заново;
 * - `unknown` — ни факта, ни подтверждённого остатка.
 */
export type ForecastLineState =
  'known' | 'estimate_only' | 'missing_remaining' | 'missing_actual' | 'stale_estimate' | 'unknown';

export const FORECAST_LINE_STATE_LABELS: Record<ForecastLineState, string> = {
  known: 'факт + подтверждённый остаток',
  estimate_only: 'работа не начата, учтён подтверждённый остаток',
  missing_remaining: 'остаток не подтверждён',
  missing_actual: 'работа начата или завершена, факт не внесён',
  stale_estimate: 'факт изменился после оценки остатка — подтвердите остаток заново',
  unknown: 'нет ни факта, ни оценки остатка',
};

const KNOWN_STATES: readonly ForecastLineState[] = ['known', 'estimate_only'];

export interface ForecastLine {
  /** null — строка РП. */
  stageId: string | null;
  name: string;
  role: string;
  status: string | null;
  rate: number;
  plannedHours: number;
  actualHours: number | null;
  remainingHours: number | null;
  /** `done` — остаток 0 по статусу этапа, `estimate` — подтверждён специалистом. */
  remainingSource: 'done' | 'estimate' | null;
  remainingEstimatedBy: string | null;
  remainingEstimatedAt: string | null;
  /** Факт на момент оценки; заполнен у устаревшей оценки, чтобы показать разницу. */
  remainingActualBaseline: number | null;
  /** Стоимость без накладных; null — неизвестна (у устаревшей оценки остаток не учитывается). */
  actualCost: number | null;
  remainingCost: number | null;
  /** Итог строки; null, если строка неполна. */
  forecastHours: number | null;
  forecastCost: number | null;
  state: ForecastLineState;
  /** Почему строка неполна; null у известных строк. */
  reason: string | null;
}

export interface ProfitForecast {
  currency: string;
  overheadPercent: number;
  lines: ForecastLine[];
  /** Строки, без которых прогноз неполон: перечисляются явно, нулём не считаются. */
  incomplete: { name: string; state: ForecastLineState; reason: string }[];
  partial: boolean;
  /** Известные части с накладными. При partial их сумма — нижняя граница затрат. */
  actualCost: number;
  remainingCost: number;
  knownCost: number;
  /** Прогноз себестоимости; null при partial. */
  forecastCost: number | null;
  /** Плановая себестоимость КП версии (с рисками и накладными). */
  plannedCost: number;
  revenue: number | null;
  revenueSource: 'contract' | 'quote';
  /** Договор в другой валюте: выручку и затраты нельзя сравнить без курса. */
  currencyMismatch: boolean;
  /** null при partial или без сопоставимой выручки. */
  profit: number | null;
  /** revenue − известные затраты: прибыль не выше этого значения. */
  profitUpperBound: number | null;
  marginPercent: number | null;
  plannedProfit: number;
  explanation: string[];
}

const money2 = (v: number) =>
  Math.round((v + Number.EPSILON * Math.max(1, Math.abs(v))) * 100) / 100;

function isoOrNull(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  return typeof v === 'string' ? v : v.toISOString();
}

/** Факт изменился с момента оценки (null и число считаются разными значениями). */
function actualChanged(baseline: number | null, actual: number | null): boolean {
  if (baseline === null || actual === null) return baseline !== actual;
  return Math.abs(baseline - actual) > 1e-9;
}

/**
 * Разбор часов из API: null/'' — очистить; число или строка из цифр (с точкой)
 * — значение ≥ 0; иначе (пробелы, буквы, массивы, логические) — undefined.
 */
export function parseHoursInput(v: unknown): number | null | undefined {
  if (v === null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : undefined;
  if (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v)) return Number(v);
  return undefined;
}

interface LineFacts {
  actualHours: number | null;
  remaining: number | null;
  baseline: number | null;
  finished: boolean;
  notStarted: boolean;
  by: string | null;
  at: string | null;
}

function forecastLine(
  base: Pick<ForecastLine, 'stageId' | 'name' | 'role' | 'status' | 'rate' | 'plannedHours'>,
  f: LineFacts,
): ForecastLine {
  const { actualHours, finished } = f;
  const remainingHours = finished ? 0 : f.remaining;
  const remainingSource = finished ? 'done' : f.remaining === null ? null : 'estimate';
  const stale = !finished && f.remaining !== null && actualChanged(f.baseline, actualHours);
  let state: ForecastLineState;
  let reason: string | null = null;
  if (finished) {
    state = actualHours === null ? 'missing_actual' : 'known';
    if (state === 'missing_actual') reason = 'этап завершён, а факт не внесён';
  } else if (actualHours === null && remainingHours === null) {
    state = 'unknown';
    reason = 'нет ни факта, ни подтверждённой оценки остатка';
  } else if (remainingHours === null) {
    state = 'missing_remaining';
    reason = 'факт внесён, остаток не подтверждён';
  } else if (stale) {
    state = 'stale_estimate';
    reason = `остаток подтверждён при факте ${f.baseline ?? 0} ч, сейчас ${actualHours ?? 0} ч — подтвердите заново`;
  } else if (actualHours === null) {
    // «Только оценка» допустима, лишь пока работа не начата: у начатой работы
    // пустой факт — это незаполненный факт, а не ноль часов.
    if (f.notStarted) state = 'estimate_only';
    else {
      state = 'missing_actual';
      reason = 'работа начата, а факт не внесён';
    }
  } else state = 'known';
  const known = KNOWN_STATES.includes(state);
  const actualCost = actualHours === null ? null : money2(actualHours * base.rate);
  const remainingCost =
    remainingHours === null || stale ? null : money2(remainingHours * base.rate);
  return {
    ...base,
    actualHours,
    remainingHours,
    remainingSource,
    remainingEstimatedBy: finished ? null : f.by,
    remainingEstimatedAt: finished ? null : f.at,
    remainingActualBaseline: stale ? f.baseline : null,
    actualCost,
    remainingCost,
    forecastHours: known ? round2((actualHours ?? 0) + (remainingHours ?? 0)) : null,
    forecastCost: known ? money2((actualCost ?? 0) + (remainingCost ?? 0)) : null,
    state,
    reason,
  };
}

/**
 * Прогноз итоговой прибыли выигранной версии: фактические затраты (часы
 * журнала × ставки версии) + подтверждённая оценка оставшейся работы, с
 * накладными версии. Строка без факта и без оценки — «неизвестно»: прогноз
 * помечается неполным с явным списком, а не считается с нулём. Завершённые
 * этапы имеют остаток 0. Ставки и проценты берутся из сохранённой версии,
 * поэтому смена ставок шаблона или новой версии прогноз не переписывает.
 */
export function profitForecast(input: ProfitForecastInput): ProfitForecast {
  const rates = resolveRoleRates(input.terms.roleRates ?? null);
  // Так же, как в calculateCommercialSummary: неизвестная роль — ставка «other».
  const rateOf = (role: string) =>
    rates[role] !== undefined ? rates[role] : (rates.other ?? DEFAULT_ROLE_RATES.other);
  const quote = calculateCommercialSummary(input.stages, input.pmHours, input.risks, input.terms);
  const overheadPercent = quote.overheadPercent;
  const lines: ForecastLine[] = input.stages
    .filter((s) => !s.isApprovalTask)
    .map((s) =>
      forecastLine(
        {
          stageId: s.id,
          name: s.name,
          role: s.role,
          status: s.status,
          rate: rateOf(s.role),
          plannedHours: s.hours,
        },
        {
          actualHours: s.actualHours,
          remaining: s.remainingHoursEstimate,
          baseline: s.remainingActualBaseline,
          finished: FINISHED_STAGE_STATUSES.includes(s.status),
          notStarted: s.status === NOT_STARTED_STAGE_STATUS,
          by: s.remainingEstimatedBy ?? null,
          at: isoOrNull(s.remainingEstimatedAt),
        },
      ),
    );
  // РП не имеет статуса: его работа считается начатой, как только начат или
  // имеет факт хотя бы один этап.
  const projectStarted = input.stages.some(
    (s) => !s.isApprovalTask && (s.status !== NOT_STARTED_STAGE_STATUS || s.actualHours !== null),
  );
  if (
    input.pmHours > 0 ||
    input.actualPmHours !== null ||
    input.remainingPmHoursEstimate !== null
  ) {
    lines.push(
      forecastLine(
        {
          stageId: null,
          name: 'Руководство проектом',
          role: 'pm',
          status: null,
          rate: rates.pm ?? DEFAULT_ROLE_RATES.pm,
          plannedHours: input.pmHours,
        },
        {
          actualHours: input.actualPmHours,
          remaining: input.remainingPmHoursEstimate,
          baseline: input.remainingPmActualBaseline,
          finished: false,
          notStarted: !projectStarted,
          by: input.remainingPmEstimatedBy ?? null,
          at: isoOrNull(input.remainingPmEstimatedAt),
        },
      ),
    );
  }
  const withOverhead = (v: number) => money2(v * (1 + overheadPercent / 100));
  const sum = (pick: (l: ForecastLine) => number | null) =>
    lines.reduce((acc, l) => acc + (pick(l) ?? 0), 0);
  const actualCost = withOverhead(sum((l) => l.actualCost));
  const remainingCost = withOverhead(sum((l) => l.remainingCost));
  const knownCost = money2(actualCost + remainingCost);
  const incomplete = lines
    .filter((l) => !KNOWN_STATES.includes(l.state))
    .map((l) => ({ name: l.name, state: l.state, reason: l.reason ?? '' }));
  const partial = incomplete.length > 0;

  const currency = quote.currency;
  const revenueSource: ProfitForecast['revenueSource'] =
    input.contractAmount !== null ? 'contract' : 'quote';
  const revenueCurrency =
    revenueSource === 'contract' ? (input.contractCurrency ?? currency) : currency;
  const currencyMismatch = revenueCurrency !== currency;
  const revenue = currencyMismatch
    ? null
    : revenueSource === 'contract'
      ? input.contractAmount
      : quote.subtotalExVat;
  const forecastCost = partial ? null : knownCost;
  const profit = revenue === null || forecastCost === null ? null : money2(revenue - forecastCost);
  const profitUpperBound = revenue === null ? null : money2(revenue - knownCost);
  const marginPercent =
    profit !== null && revenue !== null && revenue > 0 ? round2((profit / revenue) * 100) : null;

  const fmt = (v: number) => `${round2(v)} ${currency}`;
  const explanation = [
    `Ставки ролей и накладные (${overheadPercent}%) — из сохранённой версии расчёта, а не из текущего шаблона.`,
    `Фактические затраты = Σ(факт часов × ставка роли) × (1 + ${overheadPercent}%) = ${fmt(actualCost)}.`,
    `Оставшиеся затраты = Σ(подтверждённый остаток × ставка роли) × (1 + ${overheadPercent}%) = ${fmt(remainingCost)}; у завершённых этапов остаток 0.`,
    revenue === null
      ? `Выручка не сопоставима: договор в ${revenueCurrency}, расчёт в ${currency}.`
      : revenueSource === 'contract'
        ? `Выручка — сумма договора без НДС: ${fmt(revenue)}.`
        : `Сумма договора не указана: выручка — цена КП версии без НДС после скидки, ${fmt(revenue)}.`,
    partial
      ? `Прогноз неполный: ${incomplete.length} строк(и) без факта, без подтверждённого или с устаревшим остатком не считаются нулём. Затраты не меньше ${fmt(knownCost)}${profitUpperBound === null ? '' : `, прибыль не больше ${fmt(profitUpperBound)}`}.`
      : `Прогноз прибыли = выручка − (фактические + оставшиеся затраты)${profit === null ? '' : ` = ${fmt(profit)}`}.`,
  ];

  return {
    currency,
    overheadPercent,
    lines,
    incomplete,
    partial,
    actualCost,
    remainingCost,
    knownCost,
    forecastCost,
    plannedCost: quote.totalCost,
    revenue,
    revenueSource,
    currencyMismatch,
    profit,
    profitUpperBound,
    marginPercent,
    plannedProfit: quote.profitAfterDiscount,
    explanation,
  };
}

/**
 * Прогноз без исключения: некорректные сохранённые условия версии (неизвестный
 * режим цены, недопустимая целевая маржа) дают состояние ошибки, а не падение
 * страницы или API.
 */
export function tryProfitForecast(input: ProfitForecastInput): ProfitForecast | { error: string } {
  try {
    return profitForecast(input);
  } catch (e) {
    return {
      error: `Прогноз не рассчитан: ${e instanceof Error ? e.message : 'некорректные условия версии'}`,
    };
  }
}
