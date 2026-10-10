import {
  CHANGE_REQUEST_STATUSES,
  type ChangeEstimate,
  type ChangeRequestStatus,
  type ProposedChangeItem,
  type ProposedChanges,
} from './types';

export class ChangeRequestError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

/**
 * Допустимые переходы. Решения (accepted/rejected/deferred) уже описаны здесь,
 * чтобы WP-2b добавил только действия, а не перекраивал жизненный цикл.
 */
export const CHANGE_REQUEST_TRANSITIONS: Record<ChangeRequestStatus, ChangeRequestStatus[]> = {
  draft: ['submitted'],
  submitted: ['accepted', 'rejected', 'deferred'],
  deferred: ['submitted'],
  accepted: [],
  rejected: [],
};

export function isChangeRequestStatus(value: unknown): value is ChangeRequestStatus {
  return (CHANGE_REQUEST_STATUSES as readonly unknown[]).includes(value);
}

export interface TransitionContext {
  hasEstimate: boolean;
}

/** Причина отказа в переходе или null, если переход допустим. */
export function transitionError(
  from: ChangeRequestStatus,
  to: ChangeRequestStatus,
  ctx: TransitionContext,
): string | null {
  if (!CHANGE_REQUEST_TRANSITIONS[from].includes(to)) {
    return `Переход «${from} → ${to}» недопустим`;
  }
  if (to === 'accepted' && !ctx.hasEstimate) {
    return 'Принять можно только запрос с подтверждённой оценкой специалиста';
  }
  return null;
}

/** Правка содержания — только черновик: после передачи на оценку база и состав зафиксированы. */
export function canEditContent(status: ChangeRequestStatus): boolean {
  return status === 'draft';
}

/** Оценку специалист вносит (и уточняет) только пока запрос на оценке. */
export function canEstimate(status: ChangeRequestStatus): boolean {
  return status === 'submitted';
}

function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') throw new ChangeRequestError(`Поле «${field}» обязательно`);
  const trimmed = value.trim();
  if (!trimmed) throw new ChangeRequestError(`Поле «${field}» обязательно`);
  if (trimmed.length > max) throw new ChangeRequestError(`Поле «${field}» длиннее ${max} символов`);
  return trimmed;
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new ChangeRequestError(`Некорректное поле «${field}»`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new ChangeRequestError(`Поле «${field}» длиннее ${max} символов`);
  return trimmed || null;
}

function optionalId(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 100) {
    throw new ChangeRequestError(`Некорректное поле «${field}»`);
  }
  return value;
}

export interface ChangeRequestDraftInput {
  title: string;
  initiator: string;
  reason: string;
  baseCalculationId: string;
  basePackageId: string | null;
  requirementIds: string[];
  proposedChanges: ProposedChanges;
}

const KINDS = new Set(['add', 'modify', 'remove']);

export function parseProposedChanges(value: unknown): ProposedChanges {
  if (value === undefined || value === null) return { summary: '', items: [] };
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ChangeRequestError('Некорректный состав изменений');
  }
  const raw = value as Record<string, unknown>;
  const summary = optionalText(raw.summary, 'Суть изменения', 4000) ?? '';
  const rawItems = raw.items ?? [];
  if (!Array.isArray(rawItems) || rawItems.length > 200) {
    throw new ChangeRequestError('Некорректный список изменений');
  }
  const items: ProposedChangeItem[] = rawItems.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new ChangeRequestError(`Некорректное изменение №${index + 1}`);
    }
    const it = item as Record<string, unknown>;
    if (!KINDS.has(String(it.kind))) {
      throw new ChangeRequestError(`Изменение №${index + 1}: неизвестный вид`);
    }
    const kind = it.kind as ProposedChangeItem['kind'];
    const requirementId = optionalId(it.requirementId, 'Требование');
    if (kind !== 'add' && !requirementId) {
      throw new ChangeRequestError(
        `Изменение №${index + 1}: для правки или исключения укажите требование`,
      );
    }
    const text =
      kind === 'remove'
        ? (optionalText(it.text, 'Текст изменения', 4000) ?? '')
        : requiredText(it.text, `Текст изменения №${index + 1}`, 4000);
    return { kind, requirementId: kind === 'add' ? null : requirementId, text };
  });
  return { summary, items };
}

/** Проверка полей черновика: создание и правка присылают черновик целиком. */
export function parseDraftInput(body: unknown): ChangeRequestDraftInput {
  if (!body || typeof body !== 'object') throw new ChangeRequestError('Пустой запрос');
  const b = body as Record<string, unknown>;
  const baseCalculationId = optionalId(b.baseCalculationId, 'Базовый расчёт');
  if (!baseCalculationId) throw new ChangeRequestError('Выберите базовую версию расчёта');
  const rawIds = b.requirementIds ?? [];
  if (
    !Array.isArray(rawIds) ||
    rawIds.length > 500 ||
    rawIds.some((id) => typeof id !== 'string')
  ) {
    throw new ChangeRequestError('Некорректный список затронутых требований');
  }
  return {
    title: requiredText(b.title, 'Название', 200),
    initiator: requiredText(b.initiator, 'Инициатор', 200),
    reason: requiredText(b.reason, 'Причина', 4000),
    baseCalculationId,
    basePackageId: optionalId(b.basePackageId, 'Базовый комплект'),
    requirementIds: Array.from(new Set(rawIds as string[])),
    proposedChanges: parseProposedChanges(b.proposedChanges),
  };
}

const COST_RE = /^-?(0|[1-9]\d{0,15})(\.\d{1,2})?$/;

/**
 * Оценка специалиста. Все три величины обязательны и вводятся явно: ни часы
 * связанных этапов, ни что-либо ещё не подставляется по умолчанию. Значения со
 * знаком — изменение может и сокращать объём.
 */
export function parseEstimateInput(body: unknown): ChangeEstimate {
  if (!body || typeof body !== 'object') throw new ChangeRequestError('Пустая оценка');
  const b = body as Record<string, unknown>;
  const hours = b.hours;
  if (typeof hours !== 'number' || !Number.isFinite(hours) || Math.abs(hours) > 100000) {
    throw new ChangeRequestError('Укажите дополнительные часы числом (можно 0 или отрицательное)');
  }
  const rawCost = typeof b.cost === 'number' ? String(b.cost) : b.cost;
  if (typeof rawCost !== 'string' || !COST_RE.test(rawCost.trim())) {
    throw new ChangeRequestError(
      'Укажите стоимость изменения числом, не более 2 знаков после запятой',
    );
  }
  const scheduleDays = b.scheduleDays;
  if (
    typeof scheduleDays !== 'number' ||
    !Number.isInteger(scheduleDays) ||
    Math.abs(scheduleDays) > 3650
  ) {
    throw new ChangeRequestError('Укажите изменение срока целым числом рабочих дней');
  }
  return {
    hours: Math.round(hours * 100) / 100,
    cost: rawCost.trim(),
    scheduleDays,
    comment: optionalText(b.comment, 'Комментарий к оценке', 4000),
  };
}

export function formatChangeRequestNumber(seq: number): string {
  return `ЗИ-${String(seq).padStart(2, '0')}`;
}

/**
 * Роли. Запрос ведут те же, кто ведёт сделку проекта (пресейл, архитектор,
 * админ — см. /api/projects/[id]/deal). Оценку часов, стоимости и срока
 * подтверждает специалист — архитектор или админ (`hasArchitectPowers`).
 */
export const CHANGE_REQUEST_EDIT_ROLES = ['presale', 'architect', 'admin'];
export const CHANGE_REQUEST_ESTIMATE_ROLES = ['architect', 'admin'];

export function canEditChangeRequests(role: string | null | undefined): boolean {
  return !!role && CHANGE_REQUEST_EDIT_ROLES.includes(role);
}

export function canEstimateChangeRequests(role: string | null | undefined): boolean {
  return !!role && CHANGE_REQUEST_ESTIMATE_ROLES.includes(role);
}
