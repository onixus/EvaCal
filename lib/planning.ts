/**
 * Подбор даты старта и сравнение вариантов плана (#103 WP-5e): чистая логика
 * без Prisma. Выборка данных — `lib/planningData.ts`.
 *
 * Все варианты считаются в памяти поверх тех же входов, что и ресурсный план
 * (`lib/capacity.ts`), и ничего не записывают. Перенос старта перестраивает Гант
 * расчёта по его календарю и зависимостям (`lib/scheduling.ts`) — ровно так же,
 * как это потом сделает `/api/capacity/apply`.
 */
import { addUtcDays, utcDay, weekCapacityFactor, type WorkCalendar } from './calendar';
import {
  addDays,
  buildCapacityMatrix,
  capacityFor,
  spreadStageByWeek,
  weekStart,
  type CapacityCalcRow,
  type CapacityMatrix,
  type CapacityOptions,
  type CapacityStageRow,
  type RoleCapacityRow,
  type RoleReservationRow,
} from './capacity';
import { DEFAULT_ROLE_RATES, resolveRoleRates } from './commercial';
import { normalizeRoleKey } from './roles';
import {
  scheduleItems,
  workHoursOn,
  type IndexedDependency,
  type ScheduleConfig,
  type ScheduledItem,
  type StagePlanItem,
} from './scheduling';
import { round1, round2 } from './stats';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Допуск на округления часов при проверке «влезает ли». */
const FIT_EPSILON = 0.05;

/** Всё, что нужно, чтобы перестроить Гант одного расчёта без БД. */
export interface CalcPlan {
  calculationId: string;
  name: string;
  startDate: Date;
  /** Строки этапов в порядке `order` (основные и согласования). */
  items: StagePlanItem[];
  /** id строк Stage в том же порядке, что `items`. */
  stageIds: string[];
  dependencies: IndexedDependency[];
  config: ScheduleConfig;
  roleRates?: Record<string, number> | string | null;
}

/** Гант расчёта с новой датой старта (по календарю и зависимостям). */
export function reschedulePlan(plan: CalcPlan, startDate: Date): ScheduledItem[] {
  return scheduleItems(plan.items, startDate, plan.config, plan.dependencies);
}

/** Конец Ганта (последняя дата этапа или согласования). */
export function planEnd(stages: { endDate: Date }[]): Date | null {
  if (stages.length === 0) return null;
  return new Date(Math.max(...stages.map((s) => s.endDate.getTime())));
}

function toCapacityStages(stages: ScheduledItem[]): CapacityStageRow[] {
  return stages.map((s) => ({
    role: s.role,
    hours: s.hours,
    isApprovalTask: s.isApprovalTask,
    startDate: s.startDate,
    endDate: s.endDate,
  }));
}

/** Часы расчёта по роли и ISO-неделе (без согласований и заказчика). */
export function loadByRoleWeek(
  stages: CapacityStageRow[],
  includeWeekends: boolean,
  calendar?: WorkCalendar,
): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const s of stages) {
    if (s.isApprovalTask || s.hours <= 0) continue;
    const role = normalizeRoleKey(s.role);
    if (role === 'customer') continue;
    const byWeek = out.get(role) ?? new Map<string, number>();
    for (const [week, h] of spreadStageByWeek(s, includeWeekends, calendar)) {
      byWeek.set(week, (byWeek.get(week) ?? 0) + h);
    }
    out.set(role, byWeek);
  }
  return out;
}

/** Спрос остальных расчётов по роли и неделе (взвешенный — как сигналы плана). */
export function demandFromMatrix(matrix: CapacityMatrix): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const row of matrix.roles) {
    out.set(row.role, new Map(row.cells.map((c) => [c.week, c.weightedHours])));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Ближайшая доступная дата старта
// ---------------------------------------------------------------------------

export interface CapacityConflict {
  role: string;
  week: string;
  /** Спрос недели вместе с этим расчётом. */
  demand: number;
  capacity: number;
}

export interface EarliestStartInput {
  plan: CalcPlan;
  /** С какой даты искать (включительно). */
  from: Date;
  /** Сколько календарных дней перебирать. */
  horizonDays?: number;
  capacities: RoleCapacityRow[];
  /** Календарь ёмкости ролей (основной). */
  capacityCalendar?: WorkCalendar;
  reservations?: RoleReservationRow[];
  /** Спрос остальных расчётов: роль → неделя → часы. */
  otherDemand: Map<string, Map<string, number>>;
}

export interface EarliestStartResult {
  /** Найденная дата старта (начало рабочего окна) или null — в горизонте не помещается. */
  startDate: Date | null;
  endDate: Date | null;
  /** Перенос относительно текущего старта, календарных дней (для /api/capacity/apply). */
  shiftDays: number | null;
  /** Сколько дат проверено. */
  checkedDays: number;
  /** Почему не подходит дата `from`: первая перегруженная роль/неделя; null — подходит. */
  conflictAtFrom: CapacityConflict | null;
}

/** Первая роль/неделя, где расчёт со своей нагрузкой не помещается в ёмкость. */
export function firstConflict(
  own: Map<string, Map<string, number>>,
  input: Pick<
    EarliestStartInput,
    'capacities' | 'capacityCalendar' | 'reservations' | 'otherDemand'
  >,
): CapacityConflict | null {
  const conflicts: CapacityConflict[] = [];
  for (const [role, byWeek] of own) {
    for (const [week, hours] of byWeek) {
      const cap = capacityFor(role, new Date(week), input.capacities, {
        calendar: input.capacityCalendar,
        reservations: input.reservations,
      });
      // Ёмкость роли не задана — подбор её не ограничивает (как «белая» ячейка плана).
      if (cap === null) continue;
      const demand = (input.otherDemand.get(role)?.get(week) ?? 0) + hours;
      if (demand > cap + FIT_EPSILON) {
        conflicts.push({ role, week, demand: round1(demand), capacity: cap });
      }
    }
  }
  conflicts.sort((a, b) => a.week.localeCompare(b.week) || a.role.localeCompare(b.role));
  return conflicts[0] ?? null;
}

/**
 * Ближайшая дата старта не раньше `from`, при которой часы расчёта по ролям
 * помещаются в ёмкость (с учётом резервов и календаря) поверх спроса остальных
 * расчётов. Перебирает рабочие дни по календарю расчёта; Гант на каждую дату
 * строится заново с учётом зависимостей.
 */
export function findEarliestStart(input: EarliestStartInput): EarliestStartResult {
  const horizon = Math.max(1, Math.min(366, Math.floor(input.horizonDays ?? 182)));
  const first = utcDay(input.from);
  let checked = 0;
  let conflictAtFrom: CapacityConflict | null = null;
  for (let k = 0; k < horizon; k++) {
    const day = addUtcDays(first, k);
    if (workHoursOn(day, input.plan.config) <= 0) continue;
    checked++;
    const stages = reschedulePlan(input.plan, day);
    const own = loadByRoleWeek(
      toCapacityStages(stages),
      input.plan.config.includeWeekends,
      input.plan.config.calendar,
    );
    const conflict = firstConflict(own, input);
    if (checked === 1) conflictAtFrom = conflict;
    if (!conflict) {
      const start = stages.length ? stages[0].startDate : day;
      return {
        startDate: start,
        endDate: planEnd(stages),
        shiftDays: Math.round(
          (utcDay(day).getTime() - utcDay(input.plan.startDate).getTime()) / DAY_MS,
        ),
        checkedDays: checked,
        conflictAtFrom,
      };
    }
  }
  return { startDate: null, endDate: null, shiftDays: null, checkedDays: checked, conflictAtFrom };
}

// ---------------------------------------------------------------------------
// Варианты: сдвиг старта / подрядчик / изменение команды
// ---------------------------------------------------------------------------

/** Перенос старта расчёта на shiftDays календарных дней (Гант перестраивается по календарю). */
export interface ShiftChange {
  type: 'shift';
  calculationId: string;
  shiftDays: number;
}

/**
 * Часть часов роли в расчёте отдаётся подрядчику: эти часы выходят из спроса
 * роли (у подрядчика ёмкость не ограничена). Если задана ставка подрядчика —
 * считается разница стоимости против внутренней ставки роли расчёта.
 */
export interface ContractorChange {
  type: 'contractor';
  calculationId: string;
  role: string;
  /** Доля часов роли, 0 < share ≤ 1. */
  share: number;
  /** Ставка подрядчика за час, в валюте расчёта. */
  ratePerHour?: number | null;
}

/** Временное изменение команды роли: ± человек на интервале [from, to]. */
export interface TeamChange {
  type: 'team';
  role: string;
  headcountDelta: number;
  from: Date;
  to: Date;
  /** Часов в неделю на человека; по умолчанию — из текущей ёмкости роли, иначе 30. */
  hoursPerWeek?: number | null;
  /** Стоимость часа добавленного сотрудника — для оценки затрат. */
  costPerHour?: number | null;
}

export type PlanChange = ShiftChange | ContractorChange | TeamChange;

export interface PlanVariant {
  id: string;
  label: string;
  changes: PlanChange[];
}

export interface CalcEnd {
  calculationId: string;
  name: string;
  endDate: string | null;
  /** Изменение конца относительно базового плана, календарных дней. */
  deltaDays: number | null;
}

export interface VariantSummary {
  id: string;
  label: string;
  changes: PlanChange[];
  ends: CalcEnd[];
  /** Перегруженных недель (сумма по ролям, по взвешенному спросу). */
  overWeeks: number;
  overWeeksByRole: Record<string, number>;
  peakUtil: number;
  /** Разница стоимости против базового плана; null — не на чем посчитать. */
  costDelta: number | null;
  /** Часы, отданные подрядчику. */
  contractorHours: number;
  matrix: CapacityMatrix;
}

export interface VariantComparison {
  baseline: VariantSummary;
  variants: VariantSummary[];
}

export const MAX_VARIANTS = 5;
export const MAX_CHANGES = 10;

function parseDay(value: unknown): Date | null {
  if (typeof value !== 'string' && !(value instanceof Date)) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : utcDay(d);
}

function optionalNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

/** Разбор вариантов из тела запроса; бросает Error с текстом для 400. */
export function parseVariants(raw: unknown): PlanVariant[] {
  if (!Array.isArray(raw)) throw new Error('variants должен быть массивом');
  if (raw.length === 0) throw new Error('Нет вариантов для сравнения');
  if (raw.length > MAX_VARIANTS) throw new Error(`Не больше ${MAX_VARIANTS} вариантов`);
  return raw.map((v, vi) => {
    const obj = (v ?? {}) as Record<string, unknown>;
    const changesRaw = Array.isArray(obj.changes) ? obj.changes : [];
    if (changesRaw.length === 0) throw new Error(`Вариант ${vi + 1}: нет изменений`);
    if (changesRaw.length > MAX_CHANGES) {
      throw new Error(`Вариант ${vi + 1}: не больше ${MAX_CHANGES} изменений`);
    }
    const changes = changesRaw.map((c: unknown): PlanChange => {
      const ch = (c ?? {}) as Record<string, unknown>;
      const where = `Вариант ${vi + 1}`;
      if (ch.type === 'shift') {
        const shiftDays = Math.round(Number(ch.shiftDays));
        if (!ch.calculationId || !Number.isFinite(shiftDays) || Math.abs(shiftDays) > 365) {
          throw new Error(`${where}: сдвиг — расчёт и целое число дней (до 365)`);
        }
        return { type: 'shift', calculationId: String(ch.calculationId), shiftDays };
      }
      if (ch.type === 'contractor') {
        const share = Number(ch.share ?? 1);
        const ratePerHour = optionalNumber(ch.ratePerHour);
        if (!ch.calculationId || !ch.role) throw new Error(`${where}: подрядчик — расчёт и роль`);
        if (!(share > 0 && share <= 1)) throw new Error(`${where}: доля подрядчика — от 0 до 1`);
        if (Number.isNaN(ratePerHour) || (ratePerHour !== null && ratePerHour < 0)) {
          throw new Error(`${where}: ставка подрядчика — неотрицательное число`);
        }
        return {
          type: 'contractor',
          calculationId: String(ch.calculationId),
          role: normalizeRoleKey(String(ch.role)),
          share,
          ratePerHour,
        };
      }
      if (ch.type === 'team') {
        const headcountDelta = Number(ch.headcountDelta);
        const from = parseDay(ch.from);
        const to = parseDay(ch.to);
        const hoursPerWeek = optionalNumber(ch.hoursPerWeek);
        const costPerHour = optionalNumber(ch.costPerHour);
        if (!ch.role || normalizeRoleKey(String(ch.role)) === 'customer') {
          throw new Error(`${where}: команда — укажите роль исполнителя`);
        }
        if (
          !Number.isFinite(headcountDelta) ||
          headcountDelta === 0 ||
          Math.abs(headcountDelta) > 50
        ) {
          throw new Error(`${where}: изменение команды — ненулевое число человек (до ±50)`);
        }
        if (!from || !to || to < from) throw new Error(`${where}: период команды — from ≤ to`);
        if (to.getTime() - from.getTime() > 366 * DAY_MS) {
          throw new Error(`${where}: период команды — не больше года`);
        }
        if (
          Number.isNaN(hoursPerWeek) ||
          (hoursPerWeek !== null && !(hoursPerWeek > 0 && hoursPerWeek <= 60))
        ) {
          throw new Error(`${where}: часов в неделю — от 0 до 60`);
        }
        if (Number.isNaN(costPerHour) || (costPerHour !== null && costPerHour < 0)) {
          throw new Error(`${where}: стоимость часа — неотрицательное число`);
        }
        return {
          type: 'team',
          role: normalizeRoleKey(String(ch.role)),
          headcountDelta,
          from,
          to,
          hoursPerWeek,
          costPerHour,
        };
      }
      throw new Error(`${where}: неизвестный тип изменения`);
    });
    return {
      id: String(obj.id ?? `v${vi + 1}`).slice(0, 40),
      label: String(obj.label ?? `Вариант ${vi + 1}`).slice(0, 120),
      changes,
    };
  });
}

/** Расчёты, которые нужно загрузить для вариантов. */
export function variantCalculationIds(variants: PlanVariant[]): string[] {
  const ids = new Set<string>();
  for (const v of variants) {
    for (const c of v.changes) if (c.type !== 'team') ids.add(c.calculationId);
  }
  return [...ids];
}

/** Часов в неделю на человека для роли: из последней строки ёмкости, иначе 30. */
function headHoursFor(role: string, capacities: RoleCapacityRow[]): number {
  const rows = capacities
    .filter((r) => r.role === role)
    .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());
  return rows[0]?.hoursPerWeek ?? 30;
}

function summarize(
  id: string,
  label: string,
  changes: PlanChange[],
  matrix: CapacityMatrix,
  ends: Map<string, { name: string; end: Date | null }>,
  baselineEnds: Map<string, { name: string; end: Date | null }> | null,
  costDelta: number | null,
  contractorHours: number,
): VariantSummary {
  const overWeeksByRole: Record<string, number> = {};
  let overWeeks = 0;
  let peakUtil = 0;
  for (const row of matrix.roles) {
    if (row.overWeeks > 0) overWeeksByRole[row.role] = row.overWeeks;
    overWeeks += row.overWeeks;
    for (const c of row.cells) peakUtil = Math.max(peakUtil, c.weightedUtil ?? 0);
  }
  return {
    id,
    label,
    changes,
    ends: [...ends].map(([calculationId, e]) => {
      const base = baselineEnds?.get(calculationId)?.end ?? null;
      return {
        calculationId,
        name: e.name,
        endDate: e.end ? e.end.toISOString() : null,
        deltaDays:
          e.end && base
            ? Math.round((e.end.getTime() - base.getTime()) / DAY_MS)
            : e.end
              ? 0
              : null,
      };
    }),
    overWeeks,
    overWeeksByRole,
    peakUtil: round2(peakUtil),
    costDelta: costDelta === null ? null : Math.round(costDelta),
    contractorHours: round1(contractorHours),
    matrix,
  };
}

/**
 * Сравнение вариантов с базовым планом. Входы (`base`) не меняются: каждый
 * вариант строит свою копию строк расчётов и ёмкости.
 */
export function compareVariants(input: {
  base: CapacityOptions;
  plans: Map<string, CalcPlan>;
  variants: PlanVariant[];
}): VariantComparison {
  const { base, plans, variants } = input;
  const ids = variantCalculationIds(variants);
  const nameOf = (id: string) =>
    plans.get(id)?.name ?? base.calcs.find((c) => c.id === id)?.name ?? id;
  const endsOf = (calcs: CapacityCalcRow[]) => {
    const out = new Map<string, { name: string; end: Date | null }>();
    for (const id of ids) {
      const calc = calcs.find((c) => c.id === id);
      out.set(id, { name: nameOf(id), end: calc ? planEnd(calc.stages) : null });
    }
    return out;
  };

  const baselineMatrix = buildCapacityMatrix({ ...base, shifts: undefined });
  const baselineEnds = endsOf(base.calcs);
  const baseline = summarize(
    'baseline',
    'Текущий план',
    [],
    baselineMatrix,
    baselineEnds,
    null,
    0,
    0,
  );

  const results = variants.map((variant) => {
    let calcs = base.calcs.map((c) => ({ ...c, stages: [...c.stages] }));
    const adjustments: RoleReservationRow[] = [...(base.adjustments ?? [])];
    let costDelta: number | null = null;
    let contractorHours = 0;
    const addCost = (v: number) => (costDelta = (costDelta ?? 0) + v);

    // Сначала переносы: они перестраивают этапы, а подрядчик режет часы уже перенесённых.
    const ordered = [...variant.changes].sort(
      (a, b) => Number(a.type !== 'shift') - Number(b.type !== 'shift'),
    );
    for (const change of ordered) {
      if (change.type === 'shift') {
        const plan = plans.get(change.calculationId);
        const calc = calcs.find((c) => c.id === change.calculationId);
        if (!plan || !calc) continue;
        const stages = reschedulePlan(plan, addDays(plan.startDate, change.shiftDays));
        calcs = calcs.map((c) =>
          c.id === calc.id ? { ...c, stages: toCapacityStages(stages) } : c,
        );
      } else if (change.type === 'contractor') {
        const calc = calcs.find((c) => c.id === change.calculationId);
        if (!calc) continue;
        let moved = 0;
        const stages = calc.stages.map((s) => {
          if (s.isApprovalTask || normalizeRoleKey(s.role) !== change.role) return s;
          moved += s.hours * change.share;
          return { ...s, hours: s.hours * (1 - change.share) };
        });
        calcs = calcs.map((c) => (c.id === calc.id ? { ...c, stages } : c));
        contractorHours += moved;
        if (change.ratePerHour !== null && change.ratePerHour !== undefined) {
          const rates = resolveRoleRates(plans.get(calc.id)?.roleRates ?? null);
          const internal = rates[change.role] ?? DEFAULT_ROLE_RATES.other ?? 0;
          addCost(moved * (change.ratePerHour - internal));
        }
      } else {
        const perHead = change.hoursPerWeek ?? headHoursFor(change.role, base.capacities);
        const row: RoleReservationRow = {
          role: change.role,
          from: change.from,
          to: change.to,
          hoursPerWeek: change.headcountDelta * perHead,
        };
        adjustments.push(row);
        if (change.costPerHour !== null && change.costPerHour !== undefined) {
          let hours = 0;
          for (
            let monday = weekStart(change.from);
            monday.getTime() <= change.to.getTime();
            monday = addDays(monday, 7)
          ) {
            hours +=
              row.hoursPerWeek *
              weekCapacityFactor(monday, base.calendar, { from: change.from, to: change.to });
          }
          addCost(hours * change.costPerHour);
        }
      }
    }

    const matrix = buildCapacityMatrix({ ...base, calcs, adjustments, shifts: undefined });
    return summarize(
      variant.id,
      variant.label,
      variant.changes,
      matrix,
      endsOf(calcs),
      baselineEnds,
      costDelta,
      contractorHours,
    );
  });

  return { baseline, variants: results };
}

/** Сдвиги варианта, которые можно применить через /api/capacity/apply (только перенос старта). */
export function applicableShifts(variant: Pick<PlanVariant, 'changes'>): ShiftChange[] {
  return variant.changes.filter((c): c is ShiftChange => c.type === 'shift' && c.shiftDays !== 0);
}
