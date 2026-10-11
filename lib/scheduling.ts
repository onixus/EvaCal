import { APPROVAL_BUSINESS_DAYS, APPROVAL_REQUIRED_ROLES, Role } from './roles';
import {
  addUtcDays,
  dayFactor,
  DAY_MS,
  STANDARD_CALENDAR,
  utcDay,
  type WorkCalendar,
} from './calendar';

/** Начало рабочего дня, часов UTC. Весь расчёт Ганта — в UTC (см. lib/calendar.ts). */
const WORK_START_HOUR = 9;
const HOUR_MS = 3600000;

export const MIN_WORK_DAY_HOURS = 4;
export const MAX_WORK_DAY_HOURS = 6;

export interface ScheduleConfig {
  workDayHours: number; // 4-6, length of a working day starting at 09:00 UTC
  includeWeekends: boolean; // if true, the calendar's weekend days count as working days too
  /** Производственный календарь; без него — сб/вс выходные, исключений нет. */
  calendar?: WorkCalendar;
}

export const DEFAULT_SCHEDULE_CONFIG: ScheduleConfig = {
  workDayHours: 6,
  includeWeekends: false,
};

/** Защита от бесконечного цикла на вырожденном календаре (≈ 10 лет без рабочих дней). */
const MAX_SKIPPED_DAYS = 3660;

export function clampWorkDayHours(hours: number): number {
  if (!Number.isFinite(hours)) return DEFAULT_SCHEDULE_CONFIG.workDayHours;
  return Math.min(MAX_WORK_DAY_HOURS, Math.max(MIN_WORK_DAY_HOURS, Math.round(hours)));
}

/** Длина рабочего окна дня в часах с учётом выходных, праздников и сокращённых дней. */
export function workHoursOn(d: Date, config: ScheduleConfig): number {
  return (
    config.workDayHours * dayFactor(d, config.calendar ?? STANDARD_CALENDAR, config.includeWeekends)
  );
}

function dayStart(d: Date): Date {
  return new Date(utcDay(d).getTime() + WORK_START_HOUR * HOUR_MS);
}

function dayEnd(d: Date, config: ScheduleConfig): Date {
  return new Date(dayStart(d).getTime() + workHoursOn(d, config) * HOUR_MS);
}

function nextDayStart(d: Date): Date {
  return dayStart(addUtcDays(utcDay(d), 1));
}

/** Rolls a moment forward to the next point inside the configured working window. */
function nextWorkMoment(d: Date, config: ScheduleConfig): Date {
  let result = new Date(d);
  for (let guard = 0; guard <= MAX_SKIPPED_DAYS; guard++) {
    if (workHoursOn(result, config) <= 0) {
      result = nextDayStart(result);
      continue;
    }
    const start = dayStart(result);
    if (result.getTime() < start.getTime()) return start;
    if (result.getTime() >= dayEnd(result, config).getTime()) {
      result = nextDayStart(result);
      continue;
    }
    return result;
  }
  throw new Error('Календарь не содержит рабочих дней');
}

/** Advances `hours` of actual work time from `start`, skipping nights/weekends/holidays. */
function addWorkHours(start: Date, hours: number, config: ScheduleConfig): Date {
  let cursor = nextWorkMoment(start, config);
  let remaining = hours;
  while (remaining > 0) {
    const availableHours = (dayEnd(cursor, config).getTime() - cursor.getTime()) / HOUR_MS;
    if (availableHours >= remaining) {
      cursor = new Date(cursor.getTime() + remaining * HOUR_MS);
      remaining = 0;
    } else {
      remaining -= availableHours;
      cursor = nextWorkMoment(nextDayStart(cursor), config);
    }
  }
  return cursor;
}

/** Advances `days` whole business days (used for the customer approval SLA). */
function addBusinessDays(start: Date, days: number, config: ScheduleConfig): Date {
  let cursor = nextWorkMoment(start, config);
  let count = 0;
  let guard = 0;
  while (count < days) {
    cursor = new Date(cursor.getTime() + DAY_MS);
    if (workHoursOn(cursor, config) > 0) count++;
    if (++guard > MAX_SKIPPED_DAYS + days) throw new Error('Календарь не содержит рабочих дней');
  }
  // Срок не может выпасть за рабочее окно дня: у сокращённого дня оно кончается раньше.
  const end = dayEnd(cursor, config);
  return cursor.getTime() > end.getTime() ? end : cursor;
}

export interface PrimaryStageInput {
  name: string;
  role: string;
  hours: number;
  requirements?: string | null;
  /** Starts alongside the preceding non-parallel stage instead of after it. */
  parallel?: boolean;
  /** Custom duration (business days) for this stage's own approval task; defaults to APPROVAL_BUSINESS_DAYS. */
  approvalDays?: number | null;
  /** id прежней строки Stage этого этапа: по нему перестройка переносит зависимости. */
  sourceStageId?: string | null;
  /**
   * Происхождение из набора решений (#103 WP-7b). undefined — не трогать
   * сохранённое значение строки; null — снять; строка — записать.
   */
  originRef?: string | null;
}

export interface StagePlanItem {
  name: string;
  role: string;
  hours: number;
  isApprovalTask: boolean;
  requirements: string | null;
  parallel: boolean;
  approvalDays: number | null;
  /** См. PrimaryStageInput.originRef; у строк согласования не задаётся. */
  originRef?: string | null;
}

export interface ScheduledItem extends StagePlanItem {
  order: number;
  startDate: Date;
  endDate: Date;
  dueDate: Date | null;
}

/**
 * Inserts an automatic customer approval task after every stage run by a role that requires sign-off.
 * Своя длительность согласования хранится и на строке согласования (её читает
 * Гант), и на основном этапе — её читает редактор этапов, поэтому повторное
 * сохранение не сбрасывает длительность к умолчанию.
 */
export function expandWithApprovals(primary: PrimaryStageInput[]): StagePlanItem[] {
  const items: StagePlanItem[] = [];
  for (const p of primary) {
    const needsApproval = APPROVAL_REQUIRED_ROLES.includes(p.role as Role);
    items.push({
      name: p.name,
      role: p.role,
      hours: Math.max(0, p.hours),
      isApprovalTask: false,
      requirements: p.requirements ?? null,
      parallel: !!p.parallel,
      approvalDays: needsApproval ? (p.approvalDays ?? null) : null,
      ...(p.originRef !== undefined ? { originRef: p.originRef } : {}),
    });
    if (needsApproval) {
      items.push({
        name: `Согласование заказчиком: «${p.name}»`,
        role: 'customer',
        hours: 0,
        isApprovalTask: true,
        requirements: null,
        parallel: false,
        approvalDays: p.approvalDays ?? null,
      });
    }
  }
  return items;
}

/**
 * Основные этапы из сохранённых строк Stage (в порядке `order`). Длительность
 * согласования берётся с основного этапа, а для строк, сохранённых до
 * исправления, — с его строки согласования (идёт сразу за ним).
 */
export function primaryInputsFromStageRows(
  rows: {
    id: string;
    name: string;
    role: string;
    hours: number;
    isApprovalTask: boolean;
    requirements?: string | null;
    parallel?: boolean | null;
    approvalDays?: number | null;
    originRef?: string | null;
  }[],
): PrimaryStageInput[] {
  const out: PrimaryStageInput[] = [];
  rows.forEach((s, i) => {
    if (s.isApprovalTask) return;
    const next = rows[i + 1];
    const fromApproval = next && next.isApprovalTask ? (next.approvalDays ?? null) : null;
    out.push({
      name: s.name,
      role: s.role,
      hours: s.hours,
      requirements: s.requirements ?? null,
      parallel: !!s.parallel,
      approvalDays: s.approvalDays ?? fromApproval,
      sourceStageId: s.id,
      ...(s.originRef !== undefined ? { originRef: s.originRef } : {}),
    });
  });
  return out;
}

/**
 * Lays out the Gantt: each item starts right after the previous one ends, unless it's
 * flagged `parallel`, in which case it starts alongside the preceding non-parallel stage.
 * A stage's own approval task always anchors to that stage's end. The next non-parallel
 * stage waits for every item in the current parallel batch (including approvals) to finish.
 *
 * С явными зависимостями (#103 WP-5e) этап, у которого они есть, стартует только
 * от своих предшественников (неявная цепочка и флаг `parallel` для него не
 * действуют); остальные элементы — как раньше. Без зависимостей работает
 * прежний алгоритм без изменений.
 */
export function scheduleItems(
  items: StagePlanItem[],
  startDate: Date,
  config: ScheduleConfig = DEFAULT_SCHEDULE_CONFIG,
  dependencies: IndexedDependency[] = [],
): ScheduledItem[] {
  if (dependencies.length > 0) {
    return scheduleWithDependencies(items, startDate, config, dependencies);
  }
  let cursor = nextWorkMoment(startDate, config); // where the next non-parallel stage may start
  let anchorStart = cursor; // start time shared by any stage flagged parallel
  let lastStageEnd = cursor; // end of the most recent primary stage, for its own approval task

  return items.map((item, index) => {
    let start: Date;
    if (item.isApprovalTask) {
      start = lastStageEnd;
    } else if (item.parallel) {
      start = anchorStart;
    } else {
      start = cursor;
      anchorStart = start;
    }

    const end = itemEnd(item, start, config);

    if (!item.isApprovalTask) lastStageEnd = end;
    if (end > cursor) cursor = end;

    return {
      ...item,
      order: index,
      startDate: start,
      endDate: end,
      dueDate: item.isApprovalTask ? end : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Явные зависимости этапов (#103 WP-5e)
// ---------------------------------------------------------------------------

/** Тип зависимости этапов. Пока только «окончание → начало»; SS и др. — позже. */
export type StageDependencyType = 'FS';
export const STAGE_DEPENDENCY_TYPES: readonly StageDependencyType[] = ['FS'];
export const MAX_LAG_DAYS = 365;

/**
 * Явная зависимость между двумя основными этапами в терминах индексов
 * `StagePlanItem[]` (как их возвращает `expandWithApprovals` или как лежат
 * строки Stage по `order`). FS: этап `to` начинается не раньше, чем `from`
 * завершён вместе со своим согласованием заказчиком, плюс `lagDays` целых
 * рабочих дней по календарю.
 */
export interface IndexedDependency {
  from: number;
  to: number;
  type?: StageDependencyType;
  lagDays: number;
}

function itemEnd(item: StagePlanItem, start: Date, config: ScheduleConfig): Date {
  if (item.isApprovalTask) {
    return addBusinessDays(start, item.approvalDays ?? APPROVAL_BUSINESS_DAYS, config);
  }
  return item.hours > 0 ? addWorkHours(start, item.hours, config) : start;
}

/**
 * Пауза в `lagDays` целых рабочих дней после момента `finish`: день, на который
 * пришёлся конец предшественника, паузой не считается (если он кончился не в
 * самом начале дня); старт — начало первого рабочего дня после паузы.
 * lagDays = 0 — сразу, без округления.
 */
export function addLagDays(finish: Date, lagDays: number, config: ScheduleConfig): Date {
  if (lagDays <= 0) return finish;
  const first = nextWorkMoment(finish, config);
  let day = first.getTime() > dayStart(first).getTime() ? nextDayStart(first) : dayStart(first);
  let counted = 0;
  for (let guard = 0; counted < lagDays; guard++) {
    if (guard > MAX_SKIPPED_DAYS + lagDays) throw new Error('Календарь не содержит рабочих дней');
    if (workHoursOn(day, config) > 0) counted++;
    day = nextDayStart(day);
  }
  return nextWorkMoment(day, config);
}

/** Ограничение на старт элемента плана. */
type Constraint =
  /** Не раньше окончания элемента `pred` (неявная цепочка, согласование). */
  | { kind: 'end'; pred: number }
  /** Вместе со стартом `pred` (флаг parallel). */
  | { kind: 'start'; pred: number }
  /** FS: не раньше завершения этапа `pred` вместе с его согласованием + пауза. */
  | { kind: 'finish'; pred: number; lagDays: number };

/** Индекс согласования, принадлежащего основному этапу `index` (идёт сразу за ним), или -1. */
function approvalOf(items: StagePlanItem[], index: number): number {
  const next = items[index + 1];
  return next && next.isApprovalTask && !items[index].isApprovalTask ? index + 1 : -1;
}

/**
 * Ограничения старта каждого элемента: неявные, повторяющие прежний алгоритм
 * («после всех предыдущих», parallel — «вместе с последним непараллельным
 * этапом», согласование — «после своего этапа»), и явные зависимости, которые
 * заменяют неявные для своего этапа.
 */
function buildConstraints(items: StagePlanItem[], deps: IndexedDependency[]): Constraint[][] {
  const explicit = new Map<number, IndexedDependency[]>();
  for (const d of deps) explicit.set(d.to, [...(explicit.get(d.to) ?? []), d]);

  let lastPrimary = -1;
  let anchor = -1;
  return items.map((item, i) => {
    const list: Constraint[] = [];
    const own = explicit.get(i);
    if (item.isApprovalTask) {
      if (lastPrimary >= 0) list.push({ kind: 'end', pred: lastPrimary });
    } else if (own) {
      for (const d of own) list.push({ kind: 'finish', pred: d.from, lagDays: d.lagDays });
    } else if (item.parallel) {
      if (anchor >= 0) list.push({ kind: 'start', pred: anchor });
    } else {
      for (let j = 0; j < i; j++) list.push({ kind: 'end', pred: j });
    }
    if (!item.isApprovalTask) {
      lastPrimary = i;
      if (!item.parallel) anchor = i;
    }
    return list;
  });
}

/** Предшественники в графе расчёта: что должно быть посчитано раньше элемента. */
function constraintPreds(items: StagePlanItem[], constraints: Constraint[][]): number[][] {
  return constraints.map((list) => {
    const set = new Set<number>();
    for (const c of list) {
      set.add(c.pred);
      if (c.kind === 'finish') {
        const a = approvalOf(items, c.pred);
        if (a >= 0) set.add(a);
      }
    }
    return [...set];
  });
}

/** Топологический порядок (Кан); null — есть цикл. При равенстве — исходный порядок. */
function topologicalOrder(preds: number[][]): number[] | null {
  const indegree = preds.map((p) => p.length);
  const succ: number[][] = preds.map(() => []);
  preds.forEach((list, i) => list.forEach((p) => succ[p]?.push(i)));
  const ready = indegree.flatMap((d, i) => (d === 0 ? [i] : []));
  const order: number[] = [];
  while (ready.length > 0) {
    ready.sort((a, b) => a - b);
    const i = ready.shift()!;
    order.push(i);
    for (const s of succ[i]) if (--indegree[s] === 0) ready.push(s);
  }
  return order.length === preds.length ? order : null;
}

/**
 * Цикл в графе ограничений (явные зависимости вместе с неявной цепочкой):
 * индексы элементов по ходу работ, либо null. Явная зависимость «назад» по
 * списку замыкается на неявную цепочку и тоже даёт цикл.
 */
export function findDependencyCycle(
  items: StagePlanItem[],
  deps: IndexedDependency[],
): number[] | null {
  const preds = constraintPreds(items, buildConstraints(items, deps));
  if (topologicalOrder(preds)) return null;
  const state = new Array<number>(items.length).fill(0); // 0 — новый, 1 — в стеке, 2 — готов
  const stack: number[] = [];
  const visit = (i: number): number[] | null => {
    state[i] = 1;
    stack.push(i);
    for (const p of preds[i]) {
      if (state[p] === 1) return stack.slice(stack.indexOf(p));
      if (state[p] === 0) {
        const found = visit(p);
        if (found) return found;
      }
    }
    stack.pop();
    state[i] = 2;
    return null;
  };
  for (let i = 0; i < items.length; i++) {
    if (state[i] !== 0) continue;
    const found = visit(i);
    // В стеке рёбра идут «элемент → предшественник»; разворачиваем в ход работ.
    if (found) return found.reverse();
  }
  return null;
}

export interface DependencyIssue {
  code: 'not_primary' | 'self' | 'duplicate' | 'bad_lag' | 'bad_type' | 'cycle';
  message: string;
}

/** Проверка набора зависимостей: только основные этапы, без петель, дублей и циклов. */
export function validateDependencies(
  items: StagePlanItem[],
  deps: IndexedDependency[],
): DependencyIssue | null {
  const seen = new Set<string>();
  for (const d of deps) {
    const from = items[d.from];
    const to = items[d.to];
    if (!from || !to || from.isApprovalTask || to.isApprovalTask) {
      return {
        code: 'not_primary',
        message: 'Зависимость связывает только основные этапы расчёта',
      };
    }
    if (d.from === d.to) {
      return { code: 'self', message: `Этап «${to.name}» не может зависеть от самого себя` };
    }
    // Явное правило вместо косвенного «цикла с неявной цепочкой»: у
    // параллельных этапов такой цикл не возникает, но перестройка этапов всё
    // равно сняла бы обратную зависимость (carryDependencies) — отклоняем сразу.
    if (d.from > d.to) {
      return {
        code: 'cycle',
        message: `Зависимость «${from.name}» → «${to.name}» образует цикл с порядком этапов: «${from.name}» ниже по списку. Этап может зависеть только от этапов выше по списку.`,
      };
    }
    if ((d.type ?? 'FS') !== 'FS') {
      return { code: 'bad_type', message: 'Поддерживается только тип FS (окончание → начало)' };
    }
    if (!Number.isInteger(d.lagDays) || d.lagDays < 0 || d.lagDays > MAX_LAG_DAYS) {
      return { code: 'bad_lag', message: `Пауза — целое число дней от 0 до ${MAX_LAG_DAYS}` };
    }
    const key = `${d.from}->${d.to}`;
    if (seen.has(key)) {
      return {
        code: 'duplicate',
        message: `Зависимость «${from.name}» → «${to.name}» указана дважды`,
      };
    }
    seen.add(key);
  }
  const cycle = findDependencyCycle(items, deps);
  if (cycle) {
    const names = [...new Set(cycle.filter((i) => !items[i].isApprovalTask))].map(
      (i) => `«${items[i].name}»`,
    );
    return {
      code: 'cycle',
      message: `Зависимости образуют цикл: ${names.join(' → ')}. Этап может зависеть только от этапов выше по списку.`,
    };
  }
  return null;
}

/** Прежняя строка Stage для сопоставления при перестройке этапов. */
export interface ExistingStageRow {
  id: string;
  name: string;
  role: string;
  isApprovalTask: boolean;
}

/**
 * Сопоставляет элементы нового плана (`items` из `expandWithApprovals(primary)`)
 * с прежними строками Stage (в порядке `order`), чтобы перестройка обновляла
 * строки на месте и не теряла факт, журнал факта и зависимости.
 *
 * Основной этап: по `sourceStageId` (id прежней строки из редактора), иначе по
 * названию и роли — жадно в относительном порядке: одноимённые этапы
 * сопоставляются по очереди, поэтому вставка этапа выше их не меняет местами
 * (старые [X «Dev», Y «Dev»], новые [Новый, «Dev», «Dev»] → X, Y). Согласование:
 * строка согласования, шедшая сразу за сопоставленным основным этапом.
 * Результат — id прежней строки для каждого элемента или null (новая строка).
 */
export function matchStageRows(
  primary: PrimaryStageInput[],
  items: StagePlanItem[],
  oldStages: ExistingStageRow[],
): (string | null)[] {
  const result: (string | null)[] = items.map(() => null);
  const itemIndexOfPrimary: number[] = [];
  items.forEach((item, i) => {
    if (!item.isApprovalTask) itemIndexOfPrimary.push(i);
  });
  const oldPrimary = oldStages.filter((s) => !s.isApprovalTask);
  const oldIds = new Set(oldPrimary.map((s) => s.id));
  const used = new Set<string>();
  primary.forEach((p, k) => {
    if (p.sourceStageId && oldIds.has(p.sourceStageId) && !used.has(p.sourceStageId)) {
      used.add(p.sourceStageId);
      result[itemIndexOfPrimary[k]] = p.sourceStageId;
    }
  });
  primary.forEach((p, k) => {
    if (result[itemIndexOfPrimary[k]] !== null) return;
    // Первый ещё не занятый кандидат в исходном порядке.
    const pick = oldPrimary.find((s) => !used.has(s.id) && s.name === p.name && s.role === p.role);
    if (!pick) return;
    used.add(pick.id);
    result[itemIndexOfPrimary[k]] = pick.id;
  });
  items.forEach((item, i) => {
    if (!item.isApprovalTask || i === 0) return;
    const ownerId = result[i - 1];
    if (!ownerId) return;
    const pos = oldStages.findIndex((s) => s.id === ownerId);
    const next = oldStages[pos + 1];
    if (next && next.isApprovalTask && !used.has(next.id)) {
      used.add(next.id);
      result[i] = next.id;
    }
  });
  return result;
}

/**
 * Переносит зависимости прежних строк на новый план по сопоставлению
 * `matchStageRows`. Зависимость, у которой пропал конец или которая теперь
 * смотрит «назад» по списку (цикл с неявной цепочкой), снимается. Результат —
 * в индексах `items`.
 */
export function carryDependencies(
  items: StagePlanItem[],
  matched: (string | null)[],
  oldDeps: { fromStageId: string; toStageId: string; lagDays: number }[],
): IndexedDependency[] {
  if (oldDeps.length === 0) return [];
  const mapped = new Map<string, number>();
  matched.forEach((id, i) => {
    if (id && !items[i].isApprovalTask) mapped.set(id, i);
  });
  const seen = new Set<string>();
  const out: IndexedDependency[] = [];
  for (const d of oldDeps) {
    const from = mapped.get(d.fromStageId);
    const to = mapped.get(d.toStageId);
    if (from === undefined || to === undefined || from >= to) continue;
    const key = `${from}->${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ from, to, type: 'FS', lagDays: Math.max(0, Math.min(MAX_LAG_DAYS, d.lagDays)) });
  }
  return validateDependencies(items, out) ? [] : out;
}

/**
 * Расчёт Ганта по графу ограничений (топологический порядок). Экспортируется
 * для тестов: без явных зависимостей обязан совпадать с прежним алгоритмом.
 */
export function scheduleWithDependencies(
  items: StagePlanItem[],
  startDate: Date,
  config: ScheduleConfig,
  deps: IndexedDependency[],
): ScheduledItem[] {
  const issue = validateDependencies(items, deps);
  if (issue) throw new Error(issue.message);
  const constraints = buildConstraints(items, deps);
  const order = topologicalOrder(constraintPreds(items, constraints))!;
  const projectStart = nextWorkMoment(startDate, config);
  const starts: Date[] = new Array(items.length);
  const ends: Date[] = new Array(items.length);
  const finishOf = (i: number): Date => {
    const a = approvalOf(items, i);
    return a >= 0 && ends[a] > ends[i] ? ends[a] : ends[i];
  };

  for (const i of order) {
    const item = items[i];
    let start = projectStart;
    if (item.isApprovalTask) {
      // Как в прежнем алгоритме: согласование стартует ровно в момент конца этапа.
      if (constraints[i].length > 0) start = ends[constraints[i][0].pred];
    } else {
      for (const c of constraints[i]) {
        const t =
          c.kind === 'start'
            ? starts[c.pred]
            : c.kind === 'end'
              ? ends[c.pred]
              : addLagDays(finishOf(c.pred), c.lagDays, config);
        if (t > start) start = t;
      }
    }
    starts[i] = start;
    ends[i] = itemEnd(item, start, config);
  }

  return items.map((item, index) => ({
    ...item,
    order: index,
    startDate: starts[index],
    endDate: ends[index],
    dueDate: item.isApprovalTask ? ends[index] : null,
  }));
}

export function totalLaborHours(items: { hours: number; isApprovalTask: boolean }[]): number {
  return items.filter((i) => !i.isApprovalTask).reduce((sum, i) => sum + i.hours, 0);
}
