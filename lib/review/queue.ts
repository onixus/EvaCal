/**
 * Очередь «Требует моего действия» (#103 WP-3b).
 *
 * Собирает персональные задачи сотрудника из трёх источников:
 *  - активные назначения на этап (исполнителем или замещающим), пока комплект
 *    стоит на этом этапе; просроченные — первыми;
 *  - замечания в состоянии «исправлено», которые пользователь вправе
 *    проверить: свои или этапа, на который он назначен;
 *  - выпущенные им комплекты, возвращённые с замечаниями и ещё не заменённые
 *    новой версией.
 *
 * Очередь — подсказка, а не источник прав: каждое действие по-прежнему
 * проверяет маршрут (роль этапа, автор замечания).
 */
import { prisma } from '@/lib/prisma';
import { REVIEW_STAGE_LABELS } from '@/lib/gost34/review/types';
import {
  canResolveComment,
  isAssignableStage,
  isApprovedPackage,
  isSupersededPackage,
  type AssignableStage,
  type LinePackage,
  type ReviewActor,
} from './workflow';
import {
  isAssignmentActionable,
  loadNotifications,
  syncOverdueNotifications,
  type SerializedNotification,
} from './notifications';

export type QueueItemKind = 'assignment' | 'verify' | 'returned';

export interface QueueItem {
  /** Стабильный ключ для React и тестов. */
  key: string;
  kind: QueueItemKind;
  packageId: string;
  packageName: string;
  version: number;
  stage: AssignableStage | null;
  title: string;
  detail: string;
  href: string;
  dueAt: string | null;
  overdue: boolean;
  /** Для назначений: исполнитель или замещающий. */
  as?: 'assignee' | 'deputy';
  commentId?: string;
  /** С какого момента задача ждёт (для сортировки). */
  since: string;
}

interface PkgInfo {
  id: string;
  name: string;
  version: number;
  status: string;
  reviewStage: string | null;
  calculationId: string;
  documentTypes: string;
}

export interface QueueAssignmentSource {
  id: string;
  packageId: string;
  stage: string;
  assigneeId: string;
  deputyId: string | null;
  dueAt: Date;
  assignedAt: Date;
  package: PkgInfo;
}

export interface QueueCommentSource {
  id: string;
  packageId: string;
  stage: string;
  sectionId: string;
  severity: string;
  text: string;
  author: string;
  authorId: string | null;
  legacy: boolean;
  fixedAt: Date | null;
  fixedInPackageId: string | null;
  fixedInVersion: number | null;
  package: PkgInfo;
}

export interface QueueReturnedSource extends PkgInfo {
  reviewComment: string | null;
  stageEnteredAt: Date | null;
  updatedAt: Date;
}

const STAGE_SHORT: Record<AssignableStage, string> = { tw: 'нормоконтроль', gap: 'ревью ГАП' };

const fmt = (d: Date) => d.toLocaleDateString('ru-RU');

/** Чистая сборка очереди: без БД, чтобы правила проверялись тестами. */
export function composeQueue(input: {
  actor: ReviewActor;
  assignments: QueueAssignmentSource[];
  fixedComments: QueueCommentSource[];
  /** Статусы комплектов, в которых зафиксированы исправления. */
  fixedInPackages?: Pick<LinePackage, 'id' | 'status' | 'reviewStage'>[];
  returned: QueueReturnedSource[];
  /** Все версии линий возвращённых комплектов: заменённые в очередь не идут. */
  lines: LinePackage[];
  now?: Date;
}): QueueItem[] {
  const now = input.now ?? new Date();
  const userId = input.actor.actorId;
  const items: QueueItem[] = [];

  // 1. Назначения: только пока комплект стоит на этапе назначения.
  const myStages = new Set<string>();
  for (const a of input.assignments) {
    if (a.assigneeId !== userId && a.deputyId !== userId) continue;
    if (!isAssignableStage(a.stage) || !isAssignmentActionable(a.package, a.stage)) continue;
    myStages.add(`${a.packageId}:${a.stage}`);
    const overdue = a.dueAt.getTime() < now.getTime();
    const as = a.assigneeId === userId ? 'assignee' : 'deputy';
    items.push({
      key: `assignment:${a.id}`,
      kind: 'assignment',
      packageId: a.packageId,
      packageName: a.package.name,
      version: a.package.version,
      stage: a.stage,
      title: `${REVIEW_STAGE_LABELS[a.stage]}: ${a.package.name} v${a.package.version}`,
      detail: `${as === 'deputy' ? 'Вы замещающий' : 'Вы ответственный'} · ${
        overdue ? 'просрочено, срок' : 'срок'
      } ${fmt(a.dueAt)}`,
      href: `/review/${a.packageId}`,
      dueAt: a.dueAt.toISOString(),
      overdue,
      as,
      since: a.assignedAt.toISOString(),
    });
  }

  // 2. Замечания «исправлено», ждущие проверки. Право проверить считается
  // тем же правилом, что и в маршруте: автор или роль этапа.
  const fixedInStatus = new Map((input.fixedInPackages ?? []).map((p) => [p.id, p]));
  for (const c of input.fixedComments) {
    if (!isAssignableStage(c.stage) || c.legacy) continue;
    if (isApprovedPackage(c.package)) continue;
    const fixedIn = c.fixedInPackageId ? fixedInStatus.get(c.fixedInPackageId) : undefined;
    if (fixedIn && isApprovedPackage(fixedIn)) continue;
    const mine = c.authorId === userId;
    const assignedHere = Boolean(
      c.fixedInPackageId && myStages.has(`${c.fixedInPackageId}:${c.stage}`),
    );
    if (!mine && !assignedHere) continue;
    const allowed = canResolveComment(
      {
        status: 'fixed',
        stage: c.stage,
        author: c.author,
        authorId: c.authorId,
        packageVersion: c.package.version,
        packageLine: c.package,
        legacy: c.legacy,
      },
      input.actor,
    );
    if (!allowed) continue;
    const target = c.fixedInPackageId ?? c.packageId;
    items.push({
      key: `verify:${c.id}`,
      kind: 'verify',
      packageId: target,
      packageName: c.package.name,
      version: c.fixedInVersion ?? c.package.version,
      stage: c.stage,
      title: `Проверить исправление: раздел ${c.sectionId}`,
      detail: `${mine ? 'Ваше замечание' : `Замечание ${c.author}`} к v${c.package.version}, исправлено в v${
        c.fixedInVersion ?? '?'
      } · ${c.text.length > 80 ? `${c.text.slice(0, 79)}…` : c.text}`,
      href: `/review/${target}`,
      dueAt: null,
      overdue: false,
      commentId: c.id,
      since: (c.fixedAt ?? now).toISOString(),
    });
  }

  // 3. Возвращённые комплекты автора, ещё не заменённые новой версией.
  for (const p of input.returned) {
    if (p.status !== 'rejected') continue;
    if (isSupersededPackage(p, input.lines)) continue;
    const stage = p.reviewStage === 'gap' ? 'gap' : 'tw';
    items.push({
      key: `returned:${p.id}`,
      kind: 'returned',
      packageId: p.id,
      packageName: p.name,
      version: p.version,
      stage,
      title: `Исправить и выпустить новую версию: ${p.name} v${p.version}`,
      detail: `Возвращён на этапе «${STAGE_SHORT[stage]}»${
        p.reviewComment ? `: ${p.reviewComment}` : ''
      }`,
      href: `/calculations/${p.calculationId}/studio`,
      dueAt: null,
      overdue: false,
      since: (p.stageEnteredAt ?? p.updatedAt).toISOString(),
    });
  }

  // Просроченные первыми, затем по сроку, затем — кто дольше ждёт.
  return items.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    if (a.dueAt && b.dueAt && a.dueAt !== b.dueAt) return a.dueAt < b.dueAt ? -1 : 1;
    if (Boolean(a.dueAt) !== Boolean(b.dueAt)) return a.dueAt ? -1 : 1;
    return a.since < b.since ? -1 : a.since > b.since ? 1 : a.key < b.key ? -1 : 1;
  });
}

const PKG_SELECT = {
  id: true,
  name: true,
  version: true,
  status: true,
  reviewStage: true,
  calculationId: true,
  documentTypes: true,
} as const;

/** Задачи пользователя из БД. Просрочки дописываются в уведомления лениво. */
export async function loadQueueItems(actor: ReviewActor, now: Date = new Date()) {
  const userId = actor.actorId;
  await syncOverdueNotifications(userId, now);

  const assignments = await prisma.reviewAssignment.findMany({
    where: {
      active: true,
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
      assignedAt: true,
      package: { select: PKG_SELECT },
    },
  });
  const assignedPackageIds = Array.from(new Set(assignments.map((a) => a.packageId)));

  const [fixedComments, returned] = await Promise.all([
    prisma.reviewComment.findMany({
      where: {
        status: 'fixed',
        legacy: false,
        OR: [
          { authorId: userId },
          ...(assignedPackageIds.length ? [{ fixedInPackageId: { in: assignedPackageIds } }] : []),
        ],
      },
      orderBy: [{ fixedAt: 'asc' }, { id: 'asc' }],
      take: 200,
      select: {
        id: true,
        packageId: true,
        stage: true,
        sectionId: true,
        severity: true,
        text: true,
        author: true,
        authorId: true,
        legacy: true,
        fixedAt: true,
        fixedInPackageId: true,
        fixedInVersion: true,
        package: { select: PKG_SELECT },
      },
    }),
    prisma.gostPackage.findMany({
      where: { status: 'rejected', OR: [{ releasedBy: userId }, { createdBy: userId }] },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: { ...PKG_SELECT, reviewComment: true, stageEnteredAt: true, updatedAt: true },
    }),
  ]);

  const fixedInIds = Array.from(
    new Set(fixedComments.map((c) => c.fixedInPackageId).filter((v): v is string => Boolean(v))),
  );
  const calcIds = Array.from(new Set(returned.map((p) => p.calculationId)));
  const [fixedInPackages, lines] = await Promise.all([
    fixedInIds.length
      ? prisma.gostPackage.findMany({
          where: { id: { in: fixedInIds } },
          select: { id: true, status: true, reviewStage: true },
        })
      : Promise.resolve([]),
    calcIds.length
      ? prisma.gostPackage.findMany({
          where: { calculationId: { in: calcIds } },
          select: {
            id: true,
            calculationId: true,
            documentTypes: true,
            version: true,
            status: true,
            reviewStage: true,
          },
        })
      : Promise.resolve([]),
  ]);

  return composeQueue({
    actor,
    assignments,
    fixedComments,
    fixedInPackages,
    returned,
    lines,
    now,
  });
}

export interface MyQueue {
  items: QueueItem[];
  overdue: number;
  notifications: SerializedNotification[];
  unread: number;
}

/** Очередь и уведомления для экрана `/inbox` и `/api/me/queue`. */
export async function loadMyQueue(actor: ReviewActor, now: Date = new Date()): Promise<MyQueue> {
  const items = await loadQueueItems(actor, now);
  const { items: notifications, unread } = await loadNotifications(actor.actorId);
  return { items, overdue: items.filter((i) => i.overdue).length, notifications, unread };
}

/** Число для бейджа: задачи плюс непрочитанные уведомления. */
export function queueBadgeCount(queue: Pick<MyQueue, 'items' | 'unread'>): number {
  return queue.items.length + queue.unread;
}
