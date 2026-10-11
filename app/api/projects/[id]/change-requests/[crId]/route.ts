import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { clientIp, writeAudit } from '@/lib/audit';
import { changeRequestErrorResponse } from '@/lib/changeRequests/http';
import { decideChangeRequest, deleteDraftChangeRequest } from '@/lib/changeRequests/decisions';
import { notifyChangeRequest, type ChangeRequestEvent } from '@/lib/changeRequests/notify';
import {
  getChangeRequest,
  recordEstimate,
  submitChangeRequest,
  updateChangeRequestDraft,
} from '@/lib/changeRequests/store';
import {
  CHANGE_REQUEST_EDIT_ROLES,
  ChangeRequestError,
  canDecideChangeRequests,
  canEstimateChangeRequests,
  isDecision,
  parseDecisionComment,
  parseDraftInput,
  parseEstimateInput,
} from '@/lib/changeRequests/workflow';

type Props = { params: Promise<{ id: string; crId: string }> };

/** Действие → событие уведомления (правка черновика не уведомляет). */
const NOTIFY_EVENTS: Record<string, ChangeRequestEvent | undefined> = {
  submit: 'submitted',
  estimate: 'estimated',
  accept: 'accepted',
  reject: 'rejected',
  defer: 'deferred',
  reopen: 'reopened',
};

export async function GET(_req: NextRequest, props: Props) {
  const auth = await requireApiRole(CHANGE_REQUEST_EDIT_ROLES);
  if (auth instanceof NextResponse) return auth;
  const { id, crId } = await props.params;
  try {
    return NextResponse.json(await getChangeRequest(id, crId));
  } catch (error) {
    return changeRequestErrorResponse(error);
  }
}

/**
 * Действия над запросом: `update` (черновик целиком), `submit` (на оценку),
 * `estimate` (часы/стоимость/срок специалиста) и решения `accept` | `reject` |
 * `defer` | `reopen` (архитектор/админ; см. lib/changeRequests/decisions.ts).
 */
export async function PATCH(req: NextRequest, props: Props) {
  const auth = await requireApiRole(CHANGE_REQUEST_EDIT_ROLES);
  if (auth instanceof NextResponse) return auth;
  const { id, crId } = await props.params;
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const action = body?.action;
    let result;
    if (action === 'update') {
      const expected = typeof body?.updatedAt === 'string' ? new Date(body.updatedAt) : null;
      if (!expected || Number.isNaN(expected.getTime())) {
        throw new ChangeRequestError('Не указана версия черновика (updatedAt)', 400);
      }
      result = await updateChangeRequestDraft(
        id,
        crId,
        parseDraftInput(body),
        auth.username,
        expected,
      );
    } else if (action === 'submit') {
      const comment =
        typeof body?.comment === 'string' ? body.comment.trim().slice(0, 4000) || null : null;
      result = await submitChangeRequest(id, crId, auth.username, comment);
    } else if (action === 'estimate') {
      if (!canEstimateChangeRequests(auth.role)) {
        return NextResponse.json(
          { error: 'Оценку подтверждает архитектор или администратор' },
          { status: 403 },
        );
      }
      result = await recordEstimate(id, crId, parseEstimateInput(body), auth.username);
    } else if (isDecision(action)) {
      if (!canDecideChangeRequests(auth.role)) {
        return NextResponse.json(
          { error: 'Решение по запросу принимает архитектор или администратор' },
          { status: 403 },
        );
      }
      result = await decideChangeRequest(id, crId, {
        decision: action,
        actor: auth.username,
        role: auth.role,
        comment: parseDecisionComment(action, body?.comment),
      });
    } else {
      throw new ChangeRequestError('Неизвестное действие', 400);
    }
    await writeAudit({
      actorType: 'user',
      actorId: auth.userId,
      action: `change_request.${action}`,
      entityType: 'change_request',
      entityId: crId,
      meta: { projectId: id, status: result.status },
      ip: clientIp(req),
    });
    const event = NOTIFY_EVENTS[String(action)];
    if (event) {
      const last = result.events?.at(-1);
      await notifyChangeRequest(
        event,
        result,
        { userId: auth.userId, username: auth.username },
        event === 'estimated' ? result.estimateComment : (last?.comment ?? null),
      );
    }
    return NextResponse.json(result);
  } catch (error) {
    return changeRequestErrorResponse(error);
  }
}

/** Удаление черновика (кто ведёт запросы). Поданные запросы — история, не удаляются. */
export async function DELETE(req: NextRequest, props: Props) {
  const auth = await requireApiRole(CHANGE_REQUEST_EDIT_ROLES);
  if (auth instanceof NextResponse) return auth;
  const { id, crId } = await props.params;
  try {
    await deleteDraftChangeRequest(id, crId);
    await writeAudit({
      actorType: 'user',
      actorId: auth.userId,
      action: 'change_request.delete',
      entityType: 'change_request',
      entityId: crId,
      meta: { projectId: id },
      ip: clientIp(req),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return changeRequestErrorResponse(error);
  }
}
