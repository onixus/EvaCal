import { prisma } from '@/lib/prisma';
import {
  notifySafe,
  type NotificationDraft,
  type NotificationKind,
} from '@/lib/review/notifications';
import { CHANGE_REQUEST_ESTIMATE_ROLES, formatChangeRequestNumber } from './workflow';

/**
 * Уведомления о запросах на изменение (#103 §1).
 *
 * - подан на оценку / возвращён на оценку → пользователи с правом оценки
 *   (архитектор, админ);
 * - оценён / принят / отклонён / отложен → автор запроса и инициатор, если
 *   инициатор — логин сотрудника (обычно это ФИО заказчика, тогда он пропускается).
 *
 * Запрос хранит логины, поэтому получатели находятся по `User.username`;
 * неизвестные пропускаются. Самому себе о своём действии не сообщаем.
 * Уведомление — только сообщение и не влияет на права.
 */

export type ChangeRequestEvent =
  'submitted' | 'reopened' | 'estimated' | 'accepted' | 'rejected' | 'deferred';

const KIND: Record<ChangeRequestEvent, NotificationKind> = {
  submitted: 'cr_submitted',
  reopened: 'cr_reopened',
  estimated: 'cr_estimated',
  accepted: 'cr_accepted',
  rejected: 'cr_rejected',
  deferred: 'cr_deferred',
};

/** События для оценщиков; остальные — автору и инициатору. */
export function notifiesEstimators(event: ChangeRequestEvent): boolean {
  return event === 'submitted' || event === 'reopened';
}

export interface ChangeRequestRef {
  id: string;
  projectId: string;
  seq: number;
  title: string;
  basePackageId: string | null;
}

/** Черновики уведомлений: без повторов и без уведомления самому себе. */
export function changeRequestDrafts(input: {
  event: ChangeRequestEvent;
  cr: ChangeRequestRef;
  recipientIds: string[];
  actor: { userId: string; username: string };
  text?: string | null;
}): NotificationDraft[] {
  const ids = Array.from(new Set(input.recipientIds.filter(Boolean))).filter(
    (id) => id !== input.actor.userId,
  );
  const text = (input.text ?? '').trim();
  return ids.map((userId) => ({
    userId,
    kind: KIND[input.event],
    entityType: 'change_request',
    entityId: input.cr.id,
    payload: {
      ...(input.cr.basePackageId ? { packageId: input.cr.basePackageId } : {}),
      projectId: input.cr.projectId,
      changeRequestId: input.cr.id,
      crLabel: formatChangeRequestNumber(input.cr.seq),
      crTitle: input.cr.title,
      actor: input.actor.username,
      text: text ? (text.length > 200 ? `${text.slice(0, 199)}…` : text) : null,
    },
  }));
}

/** Получатели события: id пользователей. */
export async function changeRequestRecipients(
  event: ChangeRequestEvent,
  cr: { createdBy: string; initiator: string },
): Promise<string[]> {
  const rows = notifiesEstimators(event)
    ? await prisma.user.findMany({
        where: { role: { in: [...CHANGE_REQUEST_ESTIMATE_ROLES] } },
        select: { id: true },
      })
    : await prisma.user.findMany({
        where: { username: { in: Array.from(new Set([cr.createdBy, cr.initiator.trim()])) } },
        select: { id: true },
      });
  return rows.map((r) => r.id);
}

/** Уведомить о событии запроса, не роняя основное действие. */
export async function notifyChangeRequest(
  event: ChangeRequestEvent,
  cr: ChangeRequestRef & { createdBy: string; initiator: string },
  actor: { userId: string; username: string },
  text?: string | null,
): Promise<void> {
  await notifySafe(async () =>
    changeRequestDrafts({
      event,
      cr,
      recipientIds: await changeRequestRecipients(event, cr),
      actor,
      text,
    }),
  );
}
