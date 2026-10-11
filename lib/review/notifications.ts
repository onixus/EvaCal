/**
 * Уведомления внутри приложения (#103 WP-3b).
 *
 * Почты нет — у пользователя нет адреса, поэтому уведомление живёт только в
 * таблице `Notification` и показывается в очереди «Требует моего действия».
 *
 * Чистые функции `*Drafts` решают, кому и о чём сообщить; `notify*` пишут в
 * БД и никогда не роняют основное действие: сбой уведомления логируется, а
 * назначение, возврат или ответ остаются сохранены.
 *
 * Уведомление — только сообщение. Оно не участвует ни в одной проверке прав:
 * решение на этапе выносит роль этапа (`REVIEW_STAGE_ROLES`), закрыть
 * замечание — его автор или роль этапа (`canResolveComment`).
 */
import { prisma } from '@/lib/prisma';
import type { AssignableStage } from './workflow';

export type NotificationKind =
  | 'assigned'
  | 'deputy_assigned'
  | 'returned'
  | 'overdue'
  | 'comment_reply'
  | 'comment_fixed'
  | 'comment_verified'
  | 'comment_rejected'
  | 'comment_reopened';

export const NOTIFICATION_KINDS: NotificationKind[] = [
  'assigned',
  'deputy_assigned',
  'returned',
  'overdue',
  'comment_reply',
  'comment_fixed',
  'comment_verified',
  'comment_rejected',
  'comment_reopened',
];

export type NotificationEntity = 'gost_package' | 'review_assignment' | 'review_comment';

export const NOTIFICATION_LABELS: Record<NotificationKind, string> = {
  assigned: 'Назначение на этап',
  deputy_assigned: 'Назначение замещающим',
  returned: 'Комплект возвращён',
  overdue: 'Просрочен срок этапа',
  comment_reply: 'Ответ в ветке замечания',
  comment_fixed: 'Замечание отмечено исправленным',
  comment_verified: 'Исправление проверено',
  comment_rejected: 'Замечание отклонено',
  comment_reopened: 'Исправление не принято',
};

/**
 * Имя действующего лица в уведомлении — только из сессии: логин сотрудника
 * или «гость (ссылка)». Имя из тела запроса (ФИО согласующего) сюда не
 * попадает: иначе гость мог бы подписать уведомление чужим именем.
 */
export function notificationActorName(access: {
  kind: 'staff' | 'share' | 'anonymous';
  session?: { username: string } | null;
}): string {
  return access.kind === 'staff' && access.session?.username
    ? access.session.username
    : 'гость (ссылка)';
}

/** Что показать в уведомлении без дополнительных запросов. */
export interface NotificationPayload {
  packageId: string;
  packageName?: string;
  version?: number;
  stage?: AssignableStage;
  /** Кто совершил действие (логин). */
  actor?: string | null;
  /** Короткий текст: комментарий к возврату, ответ, фрагмент замечания. */
  text?: string | null;
  commentId?: string;
}

export interface NotificationDraft {
  userId: string;
  kind: NotificationKind;
  entityType: NotificationEntity;
  entityId: string;
  payload: NotificationPayload;
  dueAt?: Date | null;
}

const snippet = (text: string | null | undefined, max = 200) => {
  const t = (text ?? '').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t || null;
};

/** Без повторов и без уведомления самому себе о своём же действии. */
function recipients(ids: (string | null | undefined)[], actorId: string | null): string[] {
  return Array.from(new Set(ids.filter((id): id is string => Boolean(id)))).filter(
    (id) => id !== actorId,
  );
}

interface PackageRef {
  id: string;
  name: string;
  version: number;
}

const pkgPayload = (pkg: PackageRef): NotificationPayload => ({
  packageId: pkg.id,
  packageName: pkg.name,
  version: pkg.version,
});

/** Назначение: исполнителю — «назначен», замещающему — «замещающий». */
export function assignmentDrafts(input: {
  pkg: PackageRef;
  assignment: {
    id: string;
    stage: AssignableStage;
    assigneeId: string;
    deputyId: string | null;
    dueAt: Date | string;
  };
  actorId: string | null;
  actorName?: string | null;
}): NotificationDraft[] {
  const { pkg, assignment, actorId } = input;
  const payload: NotificationPayload = {
    ...pkgPayload(pkg),
    stage: assignment.stage,
    actor: input.actorName ?? null,
  };
  const due = new Date(assignment.dueAt);
  const out: NotificationDraft[] = [];
  for (const userId of recipients([assignment.assigneeId], actorId)) {
    out.push({
      userId,
      kind: 'assigned',
      entityType: 'review_assignment',
      entityId: assignment.id,
      payload: { ...payload, text: `Срок ${due.toLocaleDateString('ru-RU')}` },
    });
  }
  for (const userId of recipients([assignment.deputyId], actorId)) {
    if (userId === assignment.assigneeId) continue;
    out.push({
      userId,
      kind: 'deputy_assigned',
      entityType: 'review_assignment',
      entityId: assignment.id,
      payload: { ...payload, text: `Срок ${due.toLocaleDateString('ru-RU')}` },
    });
  }
  return out;
}

/**
 * Возврат комплекта: автору выпуска (он исправляет) и ответственным за этапы
 * этого комплекта — их работа откладывается до новой версии.
 */
export function returnedDrafts(input: {
  pkg: PackageRef;
  stage: AssignableStage;
  authorIds: (string | null | undefined)[];
  assignments: { assigneeId: string; deputyId: string | null }[];
  actorId: string | null;
  actorName?: string | null;
  comment?: string | null;
}): NotificationDraft[] {
  const ids = recipients(
    [...input.authorIds, ...input.assignments.flatMap((a) => [a.assigneeId, a.deputyId])],
    input.actorId,
  );
  return ids.map((userId) => ({
    userId,
    kind: 'returned' as const,
    entityType: 'gost_package' as const,
    entityId: input.pkg.id,
    payload: {
      ...pkgPayload(input.pkg),
      stage: input.stage,
      actor: input.actorName ?? null,
      text: snippet(input.comment),
    },
  }));
}

interface CommentRef {
  id: string;
  packageId: string;
  authorId: string | null;
  text: string;
}

/** Ответ в ветке: автору замечания и прежним участникам ветки. */
export function replyDrafts(input: {
  pkg: PackageRef;
  comment: CommentRef;
  participantIds: (string | null | undefined)[];
  actorId: string | null;
  actorName?: string | null;
  text: string;
}): NotificationDraft[] {
  return recipients([input.comment.authorId, ...input.participantIds], input.actorId).map(
    (userId) => ({
      userId,
      kind: 'comment_reply' as const,
      entityType: 'review_comment' as const,
      entityId: input.comment.id,
      payload: {
        ...pkgPayload(input.pkg),
        commentId: input.comment.id,
        actor: input.actorName ?? null,
        text: snippet(input.text),
      },
    }),
  );
}

/**
 * «Исправлено»: тем, кто вправе проверить, — автору замечания и персональному
 * ответственному за этап замечания (он держит роль этапа). Сам факт
 * уведомления права проверки не даёт.
 */
export function fixedDrafts(input: {
  pkg: PackageRef;
  comment: CommentRef & { stage: AssignableStage };
  verifierIds: (string | null | undefined)[];
  actorId: string | null;
  actorName?: string | null;
}): NotificationDraft[] {
  return recipients([input.comment.authorId, ...input.verifierIds], input.actorId).map(
    (userId) => ({
      userId,
      kind: 'comment_fixed' as const,
      entityType: 'review_comment' as const,
      entityId: input.comment.id,
      payload: {
        ...pkgPayload(input.pkg),
        stage: input.comment.stage,
        commentId: input.comment.id,
        actor: input.actorName ?? null,
        text: snippet(input.comment.text),
      },
    }),
  );
}

export type ResolveAction = 'verify' | 'reject' | 'reopen';

const RESOLVE_KIND: Record<ResolveAction, NotificationKind> = {
  verify: 'comment_verified',
  reject: 'comment_rejected',
  reopen: 'comment_reopened',
};

/**
 * Проверка, отклонение или возврат исправления — тому, кто отметил
 * замечание исправленным: он узнаёт, принята ли его работа.
 */
export function resolvedDrafts(input: {
  pkg: PackageRef;
  comment: CommentRef;
  action: ResolveAction;
  fixerId: string | null;
  actorId: string | null;
  actorName?: string | null;
}): NotificationDraft[] {
  return recipients([input.fixerId], input.actorId).map((userId) => ({
    userId,
    kind: RESOLVE_KIND[input.action],
    entityType: 'review_comment' as const,
    entityId: input.comment.id,
    payload: {
      ...pkgPayload(input.pkg),
      commentId: input.comment.id,
      actor: input.actorName ?? null,
      text: snippet(input.comment.text),
    },
  }));
}

/**
 * Назначение требует действия, только пока комплект стоит на этом этапе:
 * возвращённый комплект ждёт автора, а будущий этап — предыдущий.
 */
export function isAssignmentActionable(
  pkg: { status: string; reviewStage: string | null },
  stage: string,
): boolean {
  return pkg.status === 'under_review' && pkg.reviewStage === stage;
}

export interface OverdueSource {
  id: string;
  packageId: string;
  stage: string;
  assigneeId: string;
  deputyId: string | null;
  dueAt: Date;
  package: { name: string; version: number; status: string; reviewStage: string | null };
}

/**
 * Просрочки пользователя. Ключ идемпотентности — (пользователь, вид,
 * назначение, срок): повторное чтение очереди не плодит дублей, а перенос
 * срока даёт новое уведомление.
 */
export function overdueDrafts(
  userId: string,
  assignments: OverdueSource[],
  now: Date = new Date(),
): NotificationDraft[] {
  return assignments
    .filter(
      (a) =>
        (a.assigneeId === userId || a.deputyId === userId) &&
        a.dueAt.getTime() < now.getTime() &&
        isAssignmentActionable(a.package, a.stage),
    )
    .map((a) => ({
      userId,
      kind: 'overdue' as const,
      entityType: 'review_assignment' as const,
      entityId: a.id,
      dueAt: a.dueAt,
      payload: {
        packageId: a.packageId,
        packageName: a.package.name,
        version: a.package.version,
        stage: a.stage === 'gap' ? 'gap' : 'tw',
      },
    }));
}

/** Оставить только существующих пользователей: share-гости и логины не адресаты. */
async function existingUsers(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

/** Записать уведомления; дубли по ключу уникальности пропускаются. */
export async function saveNotifications(drafts: NotificationDraft[]): Promise<number> {
  if (drafts.length === 0) return 0;
  const known = await existingUsers(Array.from(new Set(drafts.map((d) => d.userId))));
  const data = drafts
    .filter((d) => known.has(d.userId))
    .map((d) => ({
      userId: d.userId,
      kind: d.kind,
      entityType: d.entityType,
      entityId: d.entityId,
      payload: d.payload as object,
      dueAt: d.dueAt ?? null,
    }));
  if (data.length === 0) return 0;
  const result = await prisma.notification.createMany({ data, skipDuplicates: true });
  return result.count;
}

/**
 * Уведомить, не роняя основное действие: оно уже сохранено, и сбой
 * уведомления не должен превращать успешный ответ в 500.
 */
export async function notifySafe(build: () => Promise<NotificationDraft[]>): Promise<void> {
  try {
    await saveNotifications(await build());
  } catch (err) {
    console.error('[notifications] failed to create notifications', err);
  }
}

/**
 * Недавно записанные просрочки процесса: ключ (пользователь, назначение,
 * срок) → время записи. Повторное чтение очереди в пределах окна не ходит в
 * БД. Это только оптимизация: идемпотентность держит уникальный ключ в БД,
 * поэтому несколько экземпляров приложения дублей не создадут.
 */
const OVERDUE_SYNC_TTL_MS = 10 * 60_000;
const recentOverdue = new Map<string, number>();

const overdueKey = (d: NotificationDraft) =>
  `${d.userId}|${d.entityId}|${d.dueAt ? d.dueAt.toISOString() : ''}`;

/** Сбросить кэш просрочек (тесты). */
export function resetOverdueSyncCache(): void {
  recentOverdue.clear();
}

/**
 * Лениво дописать просрочки пользователя — при чтении очереди и счётчиков.
 * Назначения можно передать готовыми (очередь их уже загрузила), иначе они
 * читаются здесь. Повторный вызов ничего не добавляет.
 */
export async function syncOverdueNotifications(
  userId: string,
  now: Date = new Date(),
  assignments?: OverdueSource[],
): Promise<number> {
  const rows =
    assignments ??
    (await prisma.reviewAssignment.findMany({
      where: {
        active: true,
        dueAt: { lt: now },
        OR: [{ assigneeId: userId }, { deputyId: userId }],
        package: { status: 'under_review' },
      },
      select: {
        id: true,
        packageId: true,
        stage: true,
        assigneeId: true,
        deputyId: true,
        dueAt: true,
        package: { select: { name: true, version: true, status: true, reviewStage: true } },
      },
    }));
  const at = now.getTime();
  for (const [key, savedAt] of recentOverdue) {
    if (at - savedAt > OVERDUE_SYNC_TTL_MS) recentOverdue.delete(key);
  }
  const fresh = overdueDrafts(userId, rows, now).filter((d) => !recentOverdue.has(overdueKey(d)));
  if (fresh.length === 0) return 0;
  const count = await saveNotifications(fresh);
  for (const d of fresh) recentOverdue.set(overdueKey(d), at);
  return count;
}

export interface SerializedNotification {
  id: string;
  kind: NotificationKind;
  label: string;
  entityType: NotificationEntity;
  entityId: string;
  payload: NotificationPayload;
  href: string;
  dueAt: string | null;
  createdAt: string;
  readAt: string | null;
}

/** Куда ведёт уведомление: все виды касаются комплекта и открывают его ревью. */
export function notificationHref(payload: NotificationPayload | null | undefined): string {
  return payload?.packageId ? `/review/${payload.packageId}` : '/review';
}

export function serializeNotification(row: {
  id: string;
  kind: string;
  entityType: string;
  entityId: string;
  payload: unknown;
  dueAt: Date | null;
  createdAt: Date;
  readAt: Date | null;
}): SerializedNotification {
  const kind = row.kind as NotificationKind;
  const payload = (row.payload ?? {}) as NotificationPayload;
  return {
    id: row.id,
    kind,
    label: NOTIFICATION_LABELS[kind] ?? row.kind,
    entityType: row.entityType as NotificationEntity,
    entityId: row.entityId,
    payload,
    href: notificationHref(payload),
    dueAt: row.dueAt ? row.dueAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt ? row.readAt.toISOString() : null,
  };
}

/** Последние уведомления пользователя, непрочитанные сверху. */
export async function loadNotifications(userId: string, take = 50) {
  const [rows, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
    }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);
  const items = rows.map(serializeNotification);
  items.sort((a, b) => Number(Boolean(a.readAt)) - Number(Boolean(b.readAt)));
  return { items, unread };
}

/**
 * Отметить прочитанными. Условие на userId — единственная защита от чтения
 * чужих уведомлений: id из тела запроса чужого пользователя просто не совпадёт.
 */
export async function markNotificationsRead(
  userId: string,
  ids: string[] | 'all',
  now: Date = new Date(),
): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: {
      userId,
      readAt: null,
      ...(ids === 'all' ? {} : { id: { in: ids } }),
    },
    data: { readAt: now },
  });
  return result.count;
}
