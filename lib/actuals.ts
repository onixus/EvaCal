/**
 * Факт и исход сделки (Horizon E1): чистая логика без Prisma.
 *
 * Исход живёт на проекте (сделка одна, версий расчёта много), факт часов — на
 * этапах выигранной версии. Здесь: допустимые переходы исхода, точность
 * оценки, фактическая маржа, win rate и связь скидки с исходом. Загрузка
 * данных — в `lib/actualsData.ts`.
 */
import { DEFAULT_ROLE_RATES, resolveRoleRates } from './commercial';

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
  if (project.actualsClosedAt && input.dealStatus !== 'won') {
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
      const amount =
        input.contractAmount === null || input.contractAmount === undefined
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
          contractCurrency: amount === null ? null : input.contractCurrency?.trim() || won.currency,
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
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
  stage: string;
  hours: number;
  start?: string;
  end?: string;
}

export interface ActualsImportResult {
  matched: { stageId: string; name: string; hours: number; start?: string; end?: string }[];
  unmatched: string[];
  invalid: string[];
}

/**
 * Разбирает CSV `этап;часы[;начало;окончание]` (разделитель `;` или `,`,
 * первая строка-заголовок пропускается, если не число во втором столбце) и
 * сопоставляет строки с этапами по имени без учёта регистра и пробелов.
 */
export function parseActualsCsv(text: string): { rows: ActualsCsvRow[]; invalid: string[] } {
  const rows: ActualsCsvRow[] = [];
  const invalid: string[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    const sep = line.includes(';') ? ';' : ',';
    const cells = line.split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));
    const hours = Number(String(cells[1] ?? '').replace(',', '.'));
    if (!cells[0] || !Number.isFinite(hours)) {
      if (rows.length === 0 && lines.indexOf(line) === 0) continue; // заголовок
      invalid.push(line);
      continue;
    }
    if (hours < 0) {
      invalid.push(line);
      continue;
    }
    rows.push({ stage: cells[0], hours, start: cells[2] || undefined, end: cells[3] || undefined });
  }
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
  const byName = new Map<string, { id: string; name: string }>();
  for (const s of stages) if (!s.isApprovalTask) byName.set(normName(s.name), s);
  const matched: ActualsImportResult['matched'] = [];
  const unmatched: string[] = [];
  for (const r of rows) {
    const s = byName.get(normName(r.stage));
    if (!s) {
      unmatched.push(r.stage);
      continue;
    }
    matched.push({ stageId: s.id, name: s.name, hours: r.hours, start: r.start, end: r.end });
  }
  return { matched, unmatched, invalid };
}
