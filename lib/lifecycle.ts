/**
 * Жизненный цикл проекта — один линейный конвейер от расчёта до сделки.
 *
 * До этого этап проекта приходилось собирать глазами из трёх статусов
 * (расчёт, комплект, сделка) на разных вкладках. Здесь они сводятся в одну
 * шкалу: где проект стоит сейчас, с какого момента и что нужно сделать,
 * чтобы он сдвинулся дальше. Список проектов, карточка и рабочий стол
 * читают этап отсюда, чтобы «текущий этап» везде совпадал.
 */

export type LifecycleStageId =
  | 'estimate'
  | 'estimate_review'
  | 'estimate_approved'
  | 'package'
  | 'review_tw'
  | 'review_gap'
  | 'released'
  | 'deal_closed';

export interface LifecycleStep {
  id: LifecycleStageId;
  /** Полное имя шага (степпер на карточке проекта). */
  label: string;
  /** Короткое имя (чип в списке, колонка таблицы). */
  short: string;
  /** Кто двигает проект на этом шаге. */
  owner: string;
}

export const LIFECYCLE_STEPS: LifecycleStep[] = [
  { id: 'estimate', label: 'Расчёт сметы', short: 'Расчёт', owner: 'пресейл' },
  {
    id: 'estimate_review',
    label: 'Согласование сметы',
    short: 'Согласование',
    owner: 'архитектор',
  },
  { id: 'estimate_approved', label: 'Смета утверждена', short: 'Утверждена', owner: 'архитектор' },
  { id: 'package', label: 'Комплект ГОСТ 34', short: 'Комплект', owner: 'архитектор' },
  { id: 'review_tw', label: 'Нормоконтроль', short: 'Нормоконтроль', owner: 'тех.писатель' },
  { id: 'review_gap', label: 'Ревью ГАП', short: 'Ревью ГАП', owner: 'ГАП' },
  { id: 'released', label: 'Комплект выпущен', short: 'Выпущен', owner: 'пресейл' },
  { id: 'deal_closed', label: 'Сделка закрыта', short: 'Сделка', owner: '—' },
];

export const LIFECYCLE_INDEX: Record<LifecycleStageId, number> = Object.fromEntries(
  LIFECYCLE_STEPS.map((s, i) => [s.id, i]),
) as Record<LifecycleStageId, number>;

export function lifecycleStep(id: LifecycleStageId): LifecycleStep {
  return LIFECYCLE_STEPS[LIFECYCLE_INDEX[id]];
}

/** Тревога по проекту: почему на него стоит посмотреть. */
export type LifecycleAttention = 'none' | 'rejected' | 'stale' | 'paused' | 'lost';

/** Свежесть этапа: сколько проект на нём висит относительно нормы шага. */
export type LifecycleFreshness = 'fresh' | 'warn' | 'stale';

type DateLike = Date | string | null | undefined;

export interface LifecycleInput {
  project: {
    id: string;
    status: string;
    dealStatus: string;
    dealClosedAt: DateLike;
    createdAt: DateLike;
  };
  /** Последняя версия расчёта или null, если расчётов ещё нет. */
  calculation: {
    id: string;
    status: string;
    createdAt: DateLike;
    updatedAt: DateLike;
  } | null;
  /** Последняя версия комплекта или null. */
  gostPackage: {
    id: string;
    calculationId: string;
    status: string;
    reviewStage: string;
    createdAt: DateLike;
    updatedAt: DateLike;
    releasedAt: DateLike;
    approvedAt: DateLike;
  } | null;
}

export interface LifecycleAction {
  label: string;
  href: string;
}

export interface LifecycleState {
  stage: LifecycleStageId;
  index: number;
  /** С какого момента проект на этом этапе (ISO). */
  enteredAt: string;
  /** Полных дней на этапе. */
  days: number;
  freshness: LifecycleFreshness;
  attention: LifecycleAttention;
  /** Одна строка о состоянии: «Комплект возвращён с замечаниями», «Сделка проиграна». */
  note: string;
  /** Что сделать, чтобы проект сдвинулся дальше. */
  next: LifecycleAction | null;
}

/**
 * Нормы ожидания по шагам в днях: после `warn` чип желтеет, после `stale` —
 * краснеет и проект попадает в «требуют внимания». Ревью короче остальных:
 * очередь нормоконтроля и так использовала пороги 2/5.
 */
export const STAGE_THRESHOLDS: Record<LifecycleStageId, { warn: number; stale: number }> = {
  estimate: { warn: 7, stale: 14 },
  estimate_review: { warn: 3, stale: 7 },
  estimate_approved: { warn: 7, stale: 14 },
  package: { warn: 7, stale: 14 },
  review_tw: { warn: 2, stale: 5 },
  review_gap: { warn: 2, stale: 5 },
  released: { warn: 14, stale: 30 },
  deal_closed: { warn: Infinity, stale: Infinity },
};

function toDate(value: DateLike): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function firstDate(...values: DateLike[]): Date {
  for (const v of values) {
    const d = toDate(v);
    if (d) return d;
  }
  return new Date(0);
}

export function daysSince(from: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - from.getTime()) / 86_400_000));
}

export function freshnessFor(stage: LifecycleStageId, days: number): LifecycleFreshness {
  const t = STAGE_THRESHOLDS[stage];
  if (days >= t.stale) return 'stale';
  if (days >= t.warn) return 'warn';
  return 'fresh';
}

const DEAL_NOTES: Record<string, string> = {
  won: 'Сделка выиграна',
  lost: 'Сделка проиграна',
  cancelled: 'Сделка отменена',
};

export function resolveLifecycle(input: LifecycleInput, now: Date = new Date()): LifecycleState {
  const { project, calculation: calc, gostPackage: pkg } = input;
  const projectHref = `/projects/${project.id}`;

  let stage: LifecycleStageId;
  let enteredAt: Date;
  let note: string;
  let next: LifecycleAction | null;
  let attention: LifecycleAttention = 'none';

  if (project.dealStatus && project.dealStatus !== 'open') {
    stage = 'deal_closed';
    enteredAt = firstDate(project.dealClosedAt, pkg?.updatedAt, calc?.updatedAt, project.createdAt);
    note = DEAL_NOTES[project.dealStatus] ?? 'Сделка закрыта';
    if (project.dealStatus === 'won') {
      next = { label: 'Внести факт по этапам', href: `${projectHref}#deal` };
    } else {
      attention = 'lost';
      next = null;
    }
  } else if (pkg && pkg.status === 'approved') {
    stage = 'released';
    enteredAt = firstDate(pkg.approvedAt, pkg.updatedAt, pkg.createdAt);
    note = 'Комплект выпущен и утверждён';
    next = { label: 'Зафиксировать исход сделки', href: `${projectHref}#deal` };
  } else if (pkg && pkg.status === 'under_review') {
    const gap = pkg.reviewStage === 'gap';
    stage = gap ? 'review_gap' : 'review_tw';
    enteredAt = gap
      ? firstDate(pkg.updatedAt, pkg.releasedAt, pkg.createdAt)
      : firstDate(pkg.releasedAt, pkg.updatedAt, pkg.createdAt);
    note = gap ? 'Ждёт финального решения ГАП' : 'На нормоконтроле у тех.писателя';
    next = {
      label: gap ? 'Открыть финальное ревью' : 'Открыть нормоконтроль',
      href: `/review/${pkg.id}`,
    };
  } else if (pkg && (pkg.status === 'draft' || pkg.status === 'rejected')) {
    stage = 'package';
    enteredAt = firstDate(pkg.updatedAt, pkg.createdAt);
    if (pkg.status === 'rejected') {
      attention = 'rejected';
      note = 'Комплект возвращён с замечаниями';
      next = { label: 'Исправить в Студии', href: `/calculations/${pkg.calculationId}/studio` };
    } else {
      note = 'Комплект собирается в Студии';
      next = { label: 'Выпустить комплект', href: `/calculations/${pkg.calculationId}/studio` };
    }
  } else if (calc && calc.status === 'approved') {
    stage = 'estimate_approved';
    enteredAt = firstDate(calc.updatedAt, calc.createdAt);
    note = 'Смета утверждена, комплект ещё не начат';
    next = { label: 'Открыть Студию ГОСТ 34', href: `/calculations/${calc.id}/studio` };
  } else if (calc && calc.status === 'pending_approval') {
    stage = 'estimate_review';
    enteredAt = firstDate(calc.updatedAt, calc.createdAt);
    note = 'Смета ждёт утверждения архитектором';
    next = { label: 'Утвердить смету', href: `/architect/${calc.id}` };
  } else if (calc) {
    stage = 'estimate';
    enteredAt = firstDate(calc.updatedAt, calc.createdAt);
    note = 'Черновик сметы';
    next = { label: 'Отправить на согласование', href: `/presale/${calc.id}` };
  } else {
    stage = 'estimate';
    enteredAt = firstDate(project.createdAt);
    note = 'Расчётов ещё нет';
    next = { label: 'Создать расчёт', href: `/presale?projectId=${project.id}` };
  }

  // Архивные и приостановленные проекты не «висят» — они намеренно стоят.
  if (project.status === 'on_hold' || project.status === 'archived') {
    attention = 'paused';
    note = project.status === 'archived' ? 'Проект в архиве' : 'Проект на паузе';
  }

  const days = daysSince(enteredAt, now);
  const freshness =
    attention === 'paused' || attention === 'lost' ? 'fresh' : freshnessFor(stage, days);
  if (attention === 'none' && freshness === 'stale') attention = 'stale';

  return {
    stage,
    index: LIFECYCLE_INDEX[stage],
    enteredAt: enteredAt.toISOString(),
    days,
    freshness,
    attention,
    note,
    next,
  };
}

/** «3 дн.», «сегодня», «1 дн.». */
export function formatDays(days: number): string {
  if (days <= 0) return 'сегодня';
  return `${days} дн.`;
}

export interface LifecycleSummary {
  total: number;
  byStage: Record<LifecycleStageId, number>;
  attention: number;
  rejected: number;
  stale: number;
}

/** Сводка по портфелю для рабочего стола: сколько проектов на каждом шаге. */
export function summarizeLifecycle(states: LifecycleState[]): LifecycleSummary {
  const byStage = Object.fromEntries(LIFECYCLE_STEPS.map((s) => [s.id, 0])) as Record<
    LifecycleStageId,
    number
  >;
  let rejected = 0;
  let stale = 0;
  for (const s of states) {
    byStage[s.stage] += 1;
    if (s.attention === 'rejected') rejected += 1;
    if (s.attention === 'stale') stale += 1;
  }
  return { total: states.length, byStage, attention: rejected + stale, rejected, stale };
}
