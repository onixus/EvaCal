/**
 * Правила персональных назначений и жизненного цикла замечаний ревью (#103).
 *
 * Чистые функции без доступа к БД: их используют и маршруты, и экран ревью,
 * чтобы кнопка в UI и отказ сервера опирались на одно и то же правило.
 *
 * Главное ограничение: назначение — это ответственность и срок, а не право
 * подписи. Решение на этапе по-прежнему выносит только роль этапа
 * (`REVIEW_STAGE_ROLES`, проверка в маршруте `/review`).
 */
import { hasArchitectPowers } from '@/lib/appRoles';
import {
  canDecideReviewStage,
  REVIEW_STAGE_ROLES,
  type CommentStatus,
  type ReviewStage,
} from '@/lib/gost34/review/types';

export type AssignableStage = Exclude<ReviewStage, 'done'>;

export const ASSIGNABLE_STAGES: AssignableStage[] = ['tw', 'gap'];

export function isAssignableStage(value: unknown): value is AssignableStage {
  return value === 'tw' || value === 'gap';
}

/** Кто действует: сотрудник по сессии или гость по share-ссылке. */
export interface ReviewActor {
  kind: 'staff' | 'share' | 'anonymous';
  /** Идентификатор для сравнения авторства: User.id или `share:<calc>`. */
  actorId: string;
  username?: string | null;
  role?: string | null;
}

/** Действующее лицо ревью из контекста доступа маршрута. */
export function actorFromAccess(access: {
  kind: 'staff' | 'share' | 'anonymous';
  actorId: string;
  session?: { userId: string; username: string; role: string };
}): ReviewActor {
  return {
    kind: access.kind,
    actorId: access.kind === 'staff' ? (access.session?.userId ?? access.actorId) : access.actorId,
    username: access.session?.username ?? null,
    role: access.kind === 'staff' ? (access.session?.role ?? null) : null,
  };
}

export type RuleResult = { ok: true } | { ok: false; status: number; error: string };

const deny = (status: number, error: string): RuleResult => ({ ok: false, status, error });
const OK: RuleResult = { ok: true };

/**
 * Назначать ответственного на этап вправе архитектор/админ (выпускают
 * комплект) и сама роль этапа — например, ГАП распределяет финальное ревью
 * между своими. Гость по ссылке назначений не делает.
 */
export function canAssignReviewStage(actor: ReviewActor, stage: AssignableStage): boolean {
  if (actor.kind !== 'staff') return false;
  return hasArchitectPowers(actor.role) || REVIEW_STAGE_ROLES[stage].includes(actor.role ?? '');
}

export interface AssignmentCandidate {
  id: string;
  role: string;
}

/**
 * Проверка назначения. Исполнитель обязан держать роль этапа — иначе
 * назначенный не смог бы вынести решение, и комплект завис бы. Замещающий
 * держит ту же роль, что и исполнитель: замещение не расширяет круг подписей.
 */
export function validateAssignment(input: {
  stage: AssignableStage;
  assignee: AssignmentCandidate | null;
  deputy?: AssignmentCandidate | null;
  deputyRequested?: boolean;
  dueAt: Date | null;
  now?: Date;
}): RuleResult {
  const { stage, assignee, deputy } = input;
  if (!assignee) return deny(400, 'Исполнитель не найден');
  if (!REVIEW_STAGE_ROLES[stage].includes(assignee.role)) {
    return deny(
      400,
      `На этап «${stage}» назначается роль ${REVIEW_STAGE_ROLES[stage].join(' или ')}; у исполнителя роль «${assignee.role}».`,
    );
  }
  if (input.deputyRequested && !deputy) return deny(400, 'Замещающий не найден');
  if (deputy) {
    if (deputy.id === assignee.id) return deny(400, 'Замещающий совпадает с исполнителем');
    if (deputy.role !== assignee.role) {
      return deny(
        400,
        `Замещающий должен иметь ту же роль, что и исполнитель («${assignee.role}»), а не «${deputy.role}».`,
      );
    }
  }
  if (!input.dueAt || Number.isNaN(input.dueAt.getTime())) {
    return deny(400, 'Укажите срок этапа');
  }
  return OK;
}

/** Срок прошёл, а этап ещё не закрыт. */
export function isAssignmentOverdue(dueAt: Date | string, now: Date = new Date()): boolean {
  return new Date(dueAt).getTime() < now.getTime();
}

export type CommentAction = 'fix' | 'verify' | 'reject' | 'reopen';

export const COMMENT_ACTIONS: CommentAction[] = ['fix', 'verify', 'reject', 'reopen'];

export const COMMENT_ACTION_TARGET: Record<CommentAction, CommentStatus> = {
  fix: 'fixed',
  verify: 'verified',
  reject: 'rejected',
  reopen: 'open',
};

/** Из какого состояния разрешено действие. */
const ALLOWED_FROM: Record<CommentAction, CommentStatus[]> = {
  fix: ['open'],
  verify: ['fixed'],
  reject: ['open', 'fixed'],
  reopen: ['fixed'],
};

/**
 * Линия комплекта: версии одного расчёта с одним и тем же составом документов.
 * Только внутри линии замечания переходят из версии в версию и только в ней
 * фиксируется исправление. Другой расчёт проекта или другой состав
 * документов — отдельная линия.
 */
export interface LinePackage {
  id: string;
  calculationId: string;
  documentTypes: string;
  version: number;
  status: string;
  reviewStage?: string | null;
}

export function sameLine(
  a: Pick<LinePackage, 'calculationId' | 'documentTypes'>,
  b: Pick<LinePackage, 'calculationId' | 'documentTypes'>,
): boolean {
  return a.calculationId === b.calculationId && a.documentTypes === b.documentTypes;
}

/** Утверждённая версия закрывает историю: всё, что было до неё, уже принято. */
export function isApprovedPackage(p: Pick<LinePackage, 'status' | 'reviewStage'>): boolean {
  return p.status === 'approved' || p.reviewStage === 'done';
}

/** Выпущенная версия, участвующая в ревью: не черновик и не архив. */
export function isReviewedPackage(p: Pick<LinePackage, 'status'>): boolean {
  return p.status !== 'draft' && p.status !== 'archived';
}

/**
 * Версии, незакрытые замечания которых переходят в `target`: более ранние
 * версии той же линии после последней утверждённой (барьер), кроме
 * черновиков и архивных. Перенесённые из JSON (legacy) замечания не
 * переходят никогда — это проверяет запрос.
 */
export function carrySourceIds(target: LinePackage, line: LinePackage[]): string[] {
  const earlier = line.filter(
    (p) => p.id !== target.id && sameLine(p, target) && p.version < target.version,
  );
  const barrier = Math.max(0, ...earlier.filter(isApprovedPackage).map((p) => p.version));
  return earlier
    .filter((p) => p.version > barrier && isReviewedPackage(p) && !isApprovedPackage(p))
    .map((p) => p.id);
}

/**
 * Комплект заменён более новой выпущенной версией той же линии: новые
 * замечания к нему не принимаются — они ушли бы мимо текущего ревью.
 */
export function isSupersededPackage(target: LinePackage, line: LinePackage[]): boolean {
  return line.some(
    (p) =>
      p.id !== target.id &&
      sameLine(p, target) &&
      p.version > target.version &&
      isReviewedPackage(p),
  );
}

export interface CommentRuleSubject {
  status: CommentStatus;
  stage: AssignableStage;
  author: string;
  authorId: string | null;
  /** Комплект, к которому оставлено замечание. */
  packageVersion: number;
  packageLine?: Pick<LinePackage, 'calculationId' | 'documentTypes'> | null;
  /** Перенесено из JSON: этап неизвестен, закрыть может роль любого этапа. */
  legacy?: boolean;
}

/**
 * Автор замечания. Перенесённые из JSON замечания не знают User.id автора,
 * поэтому для них сравнивается логин сотрудника.
 */
export function isCommentAuthor(subject: CommentRuleSubject, actor: ReviewActor): boolean {
  if (subject.authorId) return subject.authorId === actor.actorId;
  return actor.kind === 'staff' && !!actor.username && subject.author === actor.username;
}

/**
 * Закрыть замечание (проверить или отклонить) и вернуть его в работу вправе
 * только автор или роль этапа, на котором оно оставлено. Назначение на этап
 * такого права не даёт.
 */
export function canResolveComment(subject: CommentRuleSubject, actor: ReviewActor): boolean {
  if (isCommentAuthor(subject, actor)) return true;
  if (actor.kind !== 'staff') return false;
  if (subject.legacy) {
    return ASSIGNABLE_STAGES.some((stage) => canDecideReviewStage(actor.role, stage));
  }
  return canDecideReviewStage(actor.role, subject.stage);
}

/**
 * Отметить замечание исправленным вправе автор, архитектор/админ (они
 * выпускают исправленную версию) и роли этапов ревью. Рецензент и гость по
 * ссылке чужое замечание исправленным не отмечают.
 */
export function canMarkCommentFixed(subject: CommentRuleSubject, actor: ReviewActor): boolean {
  if (isCommentAuthor(subject, actor)) return true;
  if (actor.kind !== 'staff') return false;
  return (
    hasArchitectPowers(actor.role) ||
    ASSIGNABLE_STAGES.some((stage) => canDecideReviewStage(actor.role, stage))
  );
}

/**
 * Переход состояния замечания.
 *
 * «Исправлено» требует ссылки на более новую версию комплекта той же линии:
 * исправление в той же версии, что и замечание, невозможно — выпущенный
 * комплект неизменяем.
 */
export function checkCommentTransition(input: {
  subject: CommentRuleSubject;
  action: CommentAction;
  actor: ReviewActor;
  fixedIn?: Pick<LinePackage, 'calculationId' | 'documentTypes' | 'version' | 'status'> | null;
}): RuleResult {
  const { subject, action, actor } = input;
  if (!ALLOWED_FROM[action].includes(subject.status)) {
    return deny(
      409,
      `Действие «${action}» недоступно для замечания в состоянии «${subject.status}».`,
    );
  }
  if (action === 'fix') {
    const target = input.fixedIn;
    if (!canMarkCommentFixed(subject, actor)) {
      return deny(
        403,
        'Отметить исправление может автор замечания, архитектор, администратор или роль этапа.',
      );
    }
    if (!target) return deny(400, 'Укажите версию комплекта, в которой исправлено замечание');
    if (
      !subject.packageLine ||
      !sameLine(target, subject.packageLine) ||
      !isReviewedPackage(target) ||
      target.version <= subject.packageVersion
    ) {
      return deny(
        400,
        `Исправление фиксируется в более новой версии того же комплекта, чем v${subject.packageVersion}.`,
      );
    }
    return OK;
  }
  if (!canResolveComment(subject, actor)) {
    return deny(403, 'Закрыть или вернуть замечание может только его автор или роль этапа.');
  }
  return OK;
}
