import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { clientIp, writeAudit } from '@/lib/audit';
import { changeRequestErrorResponse } from '@/lib/changeRequests/http';
import {
  getChangeRequest,
  recordEstimate,
  submitChangeRequest,
  updateChangeRequestDraft,
} from '@/lib/changeRequests/store';
import {
  CHANGE_REQUEST_EDIT_ROLES,
  ChangeRequestError,
  canEstimateChangeRequests,
  parseDraftInput,
  parseEstimateInput,
} from '@/lib/changeRequests/workflow';

type Props = { params: Promise<{ id: string; crId: string }> };

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
 * `estimate` (часы/стоимость/срок специалиста). Решения принять/отклонить/
 * отложить и создание новой версии — следующий этап (WP-2b).
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
      result = await updateChangeRequestDraft(id, crId, parseDraftInput(body), auth.username);
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
    return NextResponse.json(result);
  } catch (error) {
    return changeRequestErrorResponse(error);
  }
}
