/**
 * Ресурсный план по портфелю (Horizon E2): чистая логика без Prisma.
 *
 * Спрос складывается из Гантов всех проектов: часы этапа раскладываются по
 * рабочим дням между его датами и суммируются по ISO-неделям и ролям. Ёмкость
 * ролей задаёт админ (headcount × часов в неделю) с датой начала действия.
 * Загрузка данных — в `lib/capacityData.ts`.
 *
 * Производственный календарь (#103 WP-5d) — общий с Гантом `lib/calendar.ts`:
 * праздник не получает часов этапа и снижает ёмкость недели, сокращённый день —
 * пропорционально, резерв роли вычитается из ёмкости.
 */
import {
  dateKey,
  dayFactor,
  nominalWorkDaysPerWeek,
  STANDARD_CALENDAR,
  utcDay,
  weekCapacityFactor,
  type WorkCalendar,
} from './calendar';
import { normalizeRoleKey } from './roles';
import { round1, round2 } from './stats';

// ---------------------------------------------------------------------------
// Входные строки
// ---------------------------------------------------------------------------

export interface CapacityStageRow {
  role: string;
  hours: number;
  isApprovalTask: boolean;
  startDate: Date;
  endDate: Date;
}

export interface CapacityCalcRow {
  id: string;
  name: string;
  version: number;
  status: string; // draft | pending_approval | approved
  projectId: string | null;
  projectName: string | null;
  dealStatus: string | null; // open | won | lost | cancelled
  wonCalculationId: string | null;
  projectStatus: string | null; // active | on_hold | completed | archived
  includeWeekends: boolean;
  /** Календарь шаблона расчёта; без него — календарь плана (`CapacityOptions.calendar`). */
  calendar?: WorkCalendar;
  stages: CapacityStageRow[];
}

export interface RoleCapacityRow {
  role: string;
  headcount: number;
  hoursPerWeek: number;
  effectiveFrom: Date;
}

/** Резерв ёмкости роли: hoursPerWeek часов в неделю на интервале [from, to] включительно. */
export interface RoleReservationRow {
  role: string;
  from: Date;
  to: Date;
  hoursPerWeek: number;
}

export interface CapacityContext {
  /** Календарь, по которому считается ёмкость ролей (по умолчанию — сб/вс без исключений). */
  calendar?: WorkCalendar;
  reservations?: RoleReservationRow[];
  /**
   * Временные изменения ёмкости для сравнения вариантов (#103 WP-5e): часы в
   * неделю со знаком на интервале, масштабируются календарём как резерв. Только
   * what-if — в БД не хранятся.
   */
  adjustments?: RoleReservationRow[];
}

/** Сдвиг расчёта для what-if: положительное — позже. */
export interface CalcShift {
  calculationId: string;
  shiftDays: number;
}

export interface CapacityOptions {
  calcs: CapacityCalcRow[];
  capacities: RoleCapacityRow[];
  /** Понедельник первой недели (любая дата — округлится вниз до понедельника). */
  from: Date;
  /** Число недель горизонта. */
  weeks: number;
  /** Учитывать ли черновики с малым весом. */
  includeDrafts?: boolean;
  shifts?: CalcShift[];
  roles?: string[];
  /** Календарь по умолчанию: ёмкость ролей и расчёты без своего календаря. */
  calendar?: WorkCalendar;
  reservations?: RoleReservationRow[];
  /** См. CapacityContext.adjustments. */
  adjustments?: RoleReservationRow[];
}

// ---------------------------------------------------------------------------
// Результат
// ---------------------------------------------------------------------------

export type CapacitySignal = 'over' | 'high' | 'ok' | 'idle' | 'unknown';

export interface CellItem {
  calculationId: string;
  name: string;
  projectName: string | null;
  hours: number;
  weight: number;
}

export interface CapacityCell {
  week: string; // ISO-дата понедельника
  firmHours: number;
  weightedHours: number;
  capacityHours: number | null;
  /** Часы, уже вычтенные из ёмкости резервами роли. */
  reservedHours: number;
  firmUtil: number | null;
  weightedUtil: number | null;
  signal: CapacitySignal;
  items: CellItem[];
}

export interface RoleRow {
  role: string;
  cells: CapacityCell[];
  totalFirm: number;
  totalWeighted: number;
  totalCapacity: number | null;
  overWeeks: number;
}

export interface CapacityMatrix {
  weeks: string[];
  roles: RoleRow[];
  /** Сколько расчётов вошло в спрос и с какими весами. */
  included: { calculationId: string; name: string; weight: number; reason: string }[];
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Веса и пороги
// ---------------------------------------------------------------------------

/**
 * Вероятность, что работа состоится. Константы в одном месте: позже сюда
 * подставляется win rate по бакету скидки из E1.
 */
export const WEIGHTS = {
  won: 1.0,
  approvedOpen: 0.6,
  pending: 0.3,
  draft: 0.1,
} as const;

export const OVER_THRESHOLD = 1.0;
export const HIGH_THRESHOLD = 0.85;
export const IDLE_THRESHOLD = 0.4;

export function weightFor(
  calc: CapacityCalcRow,
  includeDrafts = false,
): { weight: number; reason: string } {
  if (calc.dealStatus === 'lost' || calc.dealStatus === 'cancelled')
    return { weight: 0, reason: 'сделка закрыта' };
  if (calc.projectStatus === 'archived') return { weight: 0, reason: 'проект в архиве' };
  if (calc.dealStatus === 'won') {
    return calc.wonCalculationId === calc.id
      ? { weight: WEIGHTS.won, reason: 'выиграна' }
      : { weight: 0, reason: 'не та версия выигранной сделки' };
  }
  if (calc.status === 'approved')
    return { weight: WEIGHTS.approvedOpen, reason: 'утверждён, сделка открыта' };
  if (calc.status === 'pending_approval')
    return { weight: WEIGHTS.pending, reason: 'на согласовании' };
  if (calc.status === 'draft' && includeDrafts)
    return { weight: WEIGHTS.draft, reason: 'черновик' };
  return { weight: 0, reason: 'черновик' };
}

/**
 * Одна версия на проект: выигранная, иначе последняя утверждённая, иначе
 * последняя на согласовании (иначе последний черновик, если разрешено).
 * Черновики не суммируются с утверждёнными версиями того же проекта.
 */
export function selectVersionPerProject(
  calcs: CapacityCalcRow[],
  includeDrafts = false,
): CapacityCalcRow[] {
  const byProject = new Map<string, CapacityCalcRow[]>();
  const orphans: CapacityCalcRow[] = [];
  for (const c of calcs) {
    if (!c.projectId) {
      orphans.push(c);
      continue;
    }
    byProject.set(c.projectId, [...(byProject.get(c.projectId) ?? []), c]);
  }
  const rank = (status: string) =>
    status === 'approved' ? 2 : status === 'pending_approval' ? 1 : 0;
  const pick = (list: CapacityCalcRow[]): CapacityCalcRow | null => {
    const won = list.find((c) => c.dealStatus === 'won' && c.wonCalculationId === c.id);
    if (won) return won;
    const sorted = [...list].sort(
      (a, b) => rank(b.status) - rank(a.status) || b.version - a.version,
    );
    const best = sorted[0];
    if (!best) return null;
    if (best.status === 'draft' && !includeDrafts) return null;
    return best;
  };
  const out: CapacityCalcRow[] = [];
  for (const list of byProject.values()) {
    const p = pick(list);
    if (p) out.push(p);
  }
  for (const c of orphans) if (c.status !== 'draft' || includeDrafts) out.push(c);
  return out;
}

// ---------------------------------------------------------------------------
// Недели
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

/** Понедельник ISO-недели, содержащей дату (UTC, без времени). */
export function weekStart(d: Date): Date {
  const day = utcDay(d);
  const dow = (day.getUTCDay() + 6) % 7; // 0 = понедельник
  return new Date(day.getTime() - dow * DAY_MS);
}

export function weekKey(d: Date): string {
  return weekStart(d).toISOString().slice(0, 10);
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

/**
 * Раскладывает часы этапа по рабочим дням между датами (UTC) пропорционально
 * доле рабочего дня по календарю: обычный день — 1, сокращённый — меньше,
 * праздник и выходной — 0. Если рабочих дней в интервале нет (этап внутри
 * выходных при includeWeekends=false), всё падает на день начала.
 */
export function spreadStageByDay(
  stage: { hours: number; startDate: Date; endDate: Date },
  includeWeekends: boolean,
  calendar: WorkCalendar = STANDARD_CALENDAR,
): Map<string, number> {
  const out = new Map<string, number>();
  if (stage.hours <= 0) return out;
  const start = utcDay(stage.startDate);
  const end = utcDay(stage.endDate);
  const days: { day: Date; factor: number }[] = [];
  let total = 0;
  for (let d = start; d.getTime() <= end.getTime(); d = addDays(d, 1)) {
    const factor = dayFactor(d, calendar, includeWeekends);
    if (factor <= 0) continue;
    days.push({ day: d, factor });
    total += factor;
  }
  if (days.length === 0) {
    out.set(dateKey(start), stage.hours);
    return out;
  }
  for (const { day, factor } of days) {
    const k = dateKey(day);
    out.set(k, (out.get(k) ?? 0) + (stage.hours * factor) / total);
  }
  return out;
}

/** То же, что spreadStageByDay, сложенное по ISO-неделям. */
export function spreadStageByWeek(
  stage: { hours: number; startDate: Date; endDate: Date },
  includeWeekends: boolean,
  calendar: WorkCalendar = STANDARD_CALENDAR,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [day, hours] of spreadStageByDay(stage, includeWeekends, calendar)) {
    const k = weekKey(new Date(day));
    out.set(k, (out.get(k) ?? 0) + hours);
  }
  return out;
}

/**
 * Часы резервов роли в неделе. Резерв задан на обычную неделю и масштабируется
 * так же, как ёмкость: праздник внутри интервала резерва уменьшает и его.
 */
export function reservedHoursFor(
  role: string,
  week: Date,
  reservations: RoleReservationRow[] = [],
  calendar: WorkCalendar = STANDARD_CALENDAR,
): number {
  return periodHoursFor(
    role,
    week,
    reservations.filter((r) => r.hoursPerWeek > 0),
    calendar,
  );
}

/** Часы интервалов роли (резервов или временных изменений) в неделе, со знаком. */
function periodHoursFor(
  role: string,
  week: Date,
  rows: RoleReservationRow[],
  calendar: WorkCalendar,
): number {
  if (nominalWorkDaysPerWeek(calendar) <= 0) return 0;
  const monday = weekStart(week);
  const sunday = addDays(monday, 6);
  let total = 0;
  for (const r of rows) {
    if (r.role !== role || r.hoursPerWeek === 0) continue;
    const from = utcDay(r.from);
    const to = utcDay(r.to);
    if (to.getTime() < monday.getTime() || from.getTime() > sunday.getTime()) continue;
    total += r.hoursPerWeek * weekCapacityFactor(monday, calendar, { from, to });
  }
  return total;
}

/**
 * Ёмкость роли на неделю: последняя строка с effectiveFrom ≤ понедельник,
 * умноженная на долю рабочих дней недели по календарю, минус резервы роли.
 * null — ёмкость не задана. Без календаря и резервов — headcount × hoursPerWeek.
 */
export function capacityFor(
  role: string,
  week: Date,
  rows: RoleCapacityRow[],
  ctx: CapacityContext = {},
): number | null {
  let best: RoleCapacityRow | null = null;
  for (const r of rows) {
    if (r.role !== role) continue;
    if (utcDay(r.effectiveFrom).getTime() > week.getTime()) continue;
    if (!best || r.effectiveFrom.getTime() > best.effectiveFrom.getTime()) best = r;
  }
  const calendar = ctx.calendar ?? STANDARD_CALENDAR;
  const adjusted = ctx.adjustments?.length
    ? periodHoursFor(role, week, ctx.adjustments, calendar)
    : 0;
  // Временное усиление роли без заданной ёмкости даёт ёмкость с нуля.
  if (!best && adjusted <= 0) return null;
  const base = best
    ? best.headcount * best.hoursPerWeek * weekCapacityFactor(weekStart(week), calendar)
    : 0;
  const reserved = reservedHoursFor(role, week, ctx.reservations, calendar);
  return Math.round(Math.max(0, base - reserved + adjusted) * 10) / 10;
}

export function signalFor(util: number | null): CapacitySignal {
  if (util === null) return 'unknown';
  if (util > OVER_THRESHOLD) return 'over';
  if (util > HIGH_THRESHOLD) return 'high';
  if (util < IDLE_THRESHOLD) return 'idle';
  return 'ok';
}

// ---------------------------------------------------------------------------
// Матрица
// ---------------------------------------------------------------------------

export function buildCapacityMatrix(opts: CapacityOptions): CapacityMatrix {
  const first = weekStart(opts.from);
  const weeksCount = Math.max(1, Math.min(52, Math.floor(opts.weeks)));
  const weeks: string[] = [];
  for (let i = 0; i < weeksCount; i++)
    weeks.push(
      addDays(first, i * 7)
        .toISOString()
        .slice(0, 10),
    );
  const weekSet = new Set(weeks);
  const shiftOf = new Map((opts.shifts ?? []).map((s) => [s.calculationId, s.shiftDays]));

  const selected = selectVersionPerProject(opts.calcs, opts.includeDrafts);
  const included: CapacityMatrix['included'] = [];

  // role -> week -> cell accumulator
  const acc = new Map<string, Map<string, { firm: number; weighted: number; items: CellItem[] }>>();
  const touch = (role: string, week: string) => {
    let byWeek = acc.get(role);
    if (!byWeek) {
      byWeek = new Map();
      acc.set(role, byWeek);
    }
    let cell = byWeek.get(week);
    if (!cell) {
      cell = { firm: 0, weighted: 0, items: [] };
      byWeek.set(week, cell);
    }
    return cell;
  };

  for (const calc of selected) {
    const { weight, reason } = weightFor(calc, opts.includeDrafts);
    if (weight <= 0) continue;
    included.push({ calculationId: calc.id, name: calc.name, weight, reason });
    const shift = shiftOf.get(calc.id) ?? 0;
    const perCalcRole = new Map<string, Map<string, number>>();
    for (const s of calc.stages) {
      if (s.isApprovalTask || s.hours <= 0) continue;
      const role = normalizeRoleKey(s.role);
      if (role === 'customer') continue;
      if (opts.roles && opts.roles.length > 0 && !opts.roles.includes(role)) continue;
      const spread = spreadStageByWeek(
        {
          hours: s.hours,
          startDate: addDays(s.startDate, shift),
          endDate: addDays(s.endDate, shift),
        },
        calc.includeWeekends,
        calc.calendar ?? opts.calendar,
      );
      let byWeek = perCalcRole.get(role);
      if (!byWeek) {
        byWeek = new Map();
        perCalcRole.set(role, byWeek);
      }
      for (const [week, hours] of spread) {
        if (!weekSet.has(week)) continue;
        byWeek.set(week, (byWeek.get(week) ?? 0) + hours);
      }
    }
    for (const [role, byWeek] of perCalcRole) {
      for (const [week, hours] of byWeek) {
        const cell = touch(role, week);
        if (weight >= WEIGHTS.won) cell.firm += hours;
        else if (calc.status === 'approved') cell.firm += hours;
        cell.weighted += hours * weight;
        cell.items.push({
          calculationId: calc.id,
          name: calc.name,
          projectName: calc.projectName,
          hours: round1(hours),
          weight,
        });
      }
    }
  }

  const roleNames = new Set<string>([
    ...acc.keys(),
    ...[...opts.capacities, ...(opts.adjustments ?? [])]
      .map((c) => c.role)
      .filter((r) => !opts.roles || opts.roles.length === 0 || opts.roles.includes(r)),
  ]);

  const capacityCtx: CapacityContext = {
    calendar: opts.calendar,
    reservations: opts.reservations,
    adjustments: opts.adjustments,
  };
  const roles: RoleRow[] = [...roleNames]
    .sort((a, b) => a.localeCompare(b))
    .map((role) => {
      let totalFirm = 0;
      let totalWeighted = 0;
      let totalCapacity: number | null = 0;
      let overWeeks = 0;
      const cells = weeks.map((week) => {
        const a = acc.get(role)?.get(week) ?? { firm: 0, weighted: 0, items: [] };
        const weekDate = new Date(week);
        const cap = capacityFor(role, weekDate, opts.capacities, capacityCtx);
        // Показываем вычтенный резерв, а не заявленный: больше базовой ёмкости вычесть нельзя.
        const base =
          cap === null
            ? null
            : capacityFor(role, weekDate, opts.capacities, { calendar: opts.calendar });
        const reserved =
          base === null
            ? 0
            : Math.min(base, reservedHoursFor(role, weekDate, opts.reservations, opts.calendar));
        const firmUtil = cap && cap > 0 ? round2(a.firm / cap) : null;
        const weightedUtil = cap && cap > 0 ? round2(a.weighted / cap) : null;
        const signal = signalFor(weightedUtil);
        if (signal === 'over') overWeeks += 1;
        totalFirm += a.firm;
        totalWeighted += a.weighted;
        if (cap === null) totalCapacity = null;
        else if (totalCapacity !== null) totalCapacity += cap;
        return {
          week,
          firmHours: round1(a.firm),
          weightedHours: round1(a.weighted),
          capacityHours: cap,
          reservedHours: round1(reserved),
          firmUtil,
          weightedUtil,
          signal,
          items: a.items.sort((x, y) => y.hours - x.hours),
        };
      });
      return {
        role,
        cells,
        totalFirm: round1(totalFirm),
        totalWeighted: round1(totalWeighted),
        totalCapacity: totalCapacity === null ? null : round1(totalCapacity),
        overWeeks,
      };
    });

  return { weeks, roles, included, generatedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Предупреждения для одного расчёта
// ---------------------------------------------------------------------------

export interface CapacityWarning {
  role: string;
  weeks: string[];
  /** Максимальная взвешенная загрузка среди этих недель. */
  maxUtil: number;
  /** Сколько часов этого расчёта попало в перегруженные недели. */
  ownHours: number;
}

/** Недели, где роль перегружена и данный расчёт вносит в неё часы. */
export function warningsForCalculation(
  matrix: CapacityMatrix,
  calculationId: string,
): CapacityWarning[] {
  const out: CapacityWarning[] = [];
  for (const row of matrix.roles) {
    const weeks: string[] = [];
    let maxUtil = 0;
    let ownHours = 0;
    for (const cell of row.cells) {
      if (cell.signal !== 'over') continue;
      const own = cell.items.filter((i) => i.calculationId === calculationId);
      if (own.length === 0) continue;
      weeks.push(cell.week);
      maxUtil = Math.max(maxUtil, cell.weightedUtil ?? 0);
      ownHours += own.reduce((s, i) => s + i.hours, 0);
    }
    if (weeks.length > 0) out.push({ role: row.role, weeks, maxUtil, ownHours: round1(ownHours) });
  }
  return out.sort((a, b) => b.maxUtil - a.maxUtil);
}

/** Худшие роли ближайших недель — для виджета на главной архитектора. */
export function worstRoles(
  matrix: CapacityMatrix,
  limit = 3,
): { role: string; maxUtil: number; overWeeks: number }[] {
  return matrix.roles
    .map((r) => ({
      role: r.role,
      maxUtil: Math.max(0, ...r.cells.map((c) => c.weightedUtil ?? 0)),
      overWeeks: r.overWeeks,
    }))
    .filter((r) => r.maxUtil > 0)
    .sort((a, b) => b.maxUtil - a.maxUtil)
    .slice(0, limit);
}
