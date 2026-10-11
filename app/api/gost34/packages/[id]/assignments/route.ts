import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireCalcAccess } from '@/lib/access';
import { actorTypeFromAccess, clientIp, writeAudit } from '@/lib/audit';
import { handleApiError } from '@/lib/apiHelpers';
import { REVIEW_STAGE_ROLES } from '@/lib/gost34/review/types';
import {
  assignReviewStage,
  clearReviewStageAssignment,
  loadAssignmentCandidates,
  loadAssignmentHistory,
} from '@/lib/review/store';
import {
  actorFromAccess,
  ASSIGNABLE_STAGES,
  canAssignReviewStage,
  isAssignableStage,
  validateAssignment,
} from '@/lib/review/workflow';
import { assignmentDrafts, notificationActorName, notifySafe } from '@/lib/review/notifications';

type Props = { params: Promise<{ id: string }> };

/**
 * Назначения комплекта: активные по этапам, история и — для тех, кто вправе
 * назначать, — кандидаты с ролью этапа.
 */
export async function GET(req: NextRequest, props: Props) {
  try {
    const { id } = await props.params;
    const pkg = await prisma.gostPackage.findUnique({ where: { id } });
    if (!pkg) return NextResponse.json({ error: 'Пакет документов не найден' }, { status: 404 });

    const access = await requireCalcAccess(req, pkg.calculationId, ['read']);
    if (access instanceof NextResponse) return access;

    const history = await loadAssignmentHistory(pkg.id);
    const actor = actorFromAccess(access);
    const assignable = ASSIGNABLE_STAGES.filter((stage) => canAssignReviewStage(actor, stage));
    const candidates: Record<string, { id: string; username: string; role: string }[]> = {};
    for (const stage of assignable) {
      candidates[stage] = await loadAssignmentCandidates(REVIEW_STAGE_ROLES[stage]);
    }

    return NextResponse.json({
      active: history.filter((a) => a.active),
      history,
      canAssign: assignable,
      candidates,
    });
  } catch (err) {
    return handleApiError(err, 'Failed to load review assignments', 500);
  }
}

/**
 * Назначить ответственного, срок и замещающего на этап. Назначение не даёт
 * права подписи: решение по-прежнему выносит роль этапа, поэтому исполнитель
 * и замещающий обязаны эту роль держать.
 */
export async function POST(req: NextRequest, props: Props) {
  try {
    const { id } = await props.params;
    const pkg = await prisma.gostPackage.findUnique({ where: { id } });
    if (!pkg) return NextResponse.json({ error: 'Пакет документов не найден' }, { status: 404 });

    const access = await requireCalcAccess(req, pkg.calculationId, ['review']);
    if (access instanceof NextResponse) return access;

    const body = await req.json().catch(() => ({}));
    const stage = body?.stage;
    if (!isAssignableStage(stage)) {
      return NextResponse.json({ error: 'Параметр stage: tw | gap' }, { status: 400 });
    }

    const actor = actorFromAccess(access);
    if (!canAssignReviewStage(actor, stage)) {
      return NextResponse.json(
        { error: 'Назначать на этап может архитектор, администратор или роль этапа' },
        { status: 403 },
      );
    }
    if (pkg.status === 'approved' || pkg.reviewStage === 'done') {
      return NextResponse.json({ error: 'Утверждённый комплект неизменяем' }, { status: 409 });
    }

    const assigneeId = String(body?.assigneeId ?? '').trim();
    const deputyId = String(body?.deputyId ?? '').trim() || null;
    const users = await prisma.user.findMany({
      where: { id: { in: [assigneeId, deputyId].filter((v): v is string => Boolean(v)) } },
      select: { id: true, role: true },
    });
    const assignee = users.find((u) => u.id === assigneeId) ?? null;
    const deputy = deputyId ? (users.find((u) => u.id === deputyId) ?? null) : null;
    const dueAt = body?.dueAt ? new Date(body.dueAt) : null;

    const rule = validateAssignment({
      stage,
      assignee,
      deputy,
      deputyRequested: Boolean(deputyId),
      dueAt,
    });
    if (!rule.ok) return NextResponse.json({ error: rule.error }, { status: rule.status });

    let assignment;
    try {
      assignment = await assignReviewStage({
        packageId: pkg.id,
        stage,
        assigneeId: assignee!.id,
        deputyId: deputy?.id ?? null,
        dueAt: dueAt!,
        assignedBy: actor.actorId,
      });
    } catch (err) {
      // Параллельное назначение на тот же этап упирается в частичный
      // уникальный индекс — это конфликт, а не сбой сервера.
      if ((err as { code?: string })?.code === 'P2002') {
        return NextResponse.json(
          { error: 'Этап только что назначен другим пользователем, обновите страницу' },
          { status: 409 },
        );
      }
      throw err;
    }

    await writeAudit({
      actorType: actorTypeFromAccess(access.kind),
      actorId: actor.actorId,
      action: 'review_assignment.assign',
      entityType: 'gost_package',
      entityId: pkg.id,
      meta: {
        stage,
        assigneeId: assignment.assigneeId,
        deputyId: assignment.deputyId,
        dueAt: assignment.dueAt,
      },
      ip: clientIp(req),
    });

    // Уведомление — только сообщение: права подписи оно не добавляет.
    await notifySafe(async () =>
      assignmentDrafts({
        pkg,
        assignment,
        actorId: actor.actorId,
        actorName: notificationActorName(access),
      }),
    );

    return NextResponse.json({ assignment }, { status: 201 });
  } catch (err) {
    return handleApiError(err, 'Failed to assign review stage', 500);
  }
}

/** Снять активное назначение этапа: `?stage=tw|gap`. */
export async function DELETE(req: NextRequest, props: Props) {
  try {
    const { id } = await props.params;
    const pkg = await prisma.gostPackage.findUnique({ where: { id } });
    if (!pkg) return NextResponse.json({ error: 'Пакет документов не найден' }, { status: 404 });

    const access = await requireCalcAccess(req, pkg.calculationId, ['review']);
    if (access instanceof NextResponse) return access;

    const stage = req.nextUrl.searchParams.get('stage');
    if (!isAssignableStage(stage)) {
      return NextResponse.json({ error: 'Параметр stage: tw | gap' }, { status: 400 });
    }
    const actor = actorFromAccess(access);
    if (!canAssignReviewStage(actor, stage)) {
      return NextResponse.json(
        { error: 'Снимать назначение может архитектор, администратор или роль этапа' },
        { status: 403 },
      );
    }

    const result = await clearReviewStageAssignment(pkg.id, stage);
    await writeAudit({
      actorType: actorTypeFromAccess(access.kind),
      actorId: actor.actorId,
      action: 'review_assignment.clear',
      entityType: 'gost_package',
      entityId: pkg.id,
      meta: { stage, cleared: result.count },
      ip: clientIp(req),
    });
    return NextResponse.json({ cleared: result.count });
  } catch (err) {
    return handleApiError(err, 'Failed to clear review assignment', 500);
  }
}
