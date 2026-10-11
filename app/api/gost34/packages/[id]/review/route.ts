import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireCalcAccess } from '@/lib/access';
import { actorTypeFromAccess, clientIp, writeAudit } from '@/lib/audit';
import { GostReviewConflictError, reviewGostPackage } from '@/lib/project';
import { parsePackageSnapshot } from '@/lib/gost34/diff';
import { handleApiError } from '@/lib/apiHelpers';
import { recordInternalChangeSafe } from '@/lib/changelog';
import { countOpenBlockers } from '@/lib/review/store';
import { notificationActorName, notifySafe, returnedDrafts } from '@/lib/review/notifications';
import {
  REVIEW_STAGE_LABELS,
  REVIEW_STAGE_ROLES,
  SHARE_ALLOWED_STAGES,
  type ReviewStage,
} from '@/lib/gost34/review/types';

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const params = await props.params;
    const pkg = await prisma.gostPackage.findUnique({
      where: { id: params.id },
    });

    if (!pkg) {
      return NextResponse.json({ error: 'Пакет документов не найден' }, { status: 404 });
    }

    const access = await requireCalcAccess(req, pkg.calculationId, ['review']);
    if (access instanceof NextResponse) return access;

    const body = await req.json();
    const { decision, comment, reviewerName } = body;

    if (decision !== 'approve' && decision !== 'reject') {
      return NextResponse.json(
        { error: 'Параметр decision должен быть approve или reject' },
        { status: 400 },
      );
    }

    if (pkg.status === 'approved') {
      return NextResponse.json(
        { error: 'Утверждённый комплект документов неизменяем' },
        { status: 409 },
      );
    }

    // Возвращённый комплект ждёт новой версии: повторное решение по нему
    // ничего не меняло бы, но разослало бы уведомления о возврате ещё раз.
    if (pkg.status === 'rejected') {
      return NextResponse.json(
        { error: 'Комплект уже возвращён с замечаниями: решение выносится по новой версии' },
        { status: 409 },
      );
    }

    const actorDisplayName =
      reviewerName?.trim() || (access.kind === 'staff' ? access.session?.username : access.actorId);

    const stageBefore = (pkg.reviewStage === 'gap' ? 'gap' : 'tw') as ReviewStage;

    // Решение на этапе выносит только та роль, которой этот этап принадлежит:
    // нормоконтроль — ревьювер, финальную подпись — ГАП. Проверка стоит здесь,
    // а не в UI, иначе прямой запрос к API обходит разделение ответственности.
    const allowedRoles = REVIEW_STAGE_ROLES[stageBefore as 'tw' | 'gap'];
    if (access.kind === 'staff') {
      const role = access.session?.role ?? '';
      if (!allowedRoles.includes(role)) {
        return NextResponse.json(
          {
            error: `Этап «${REVIEW_STAGE_LABELS[stageBefore]}» выносит другая роль: ${allowedRoles.join(', ')}. Текущая роль — ${role || 'не определена'}.`,
          },
          { status: 403 },
        );
      }
    } else if (!SHARE_ALLOWED_STAGES.includes(stageBefore)) {
      return NextResponse.json(
        {
          error: `Этап «${REVIEW_STAGE_LABELS[stageBefore]}» недоступен по share-ссылке: решение принимает ГАП в системе.`,
        },
        { status: 403 },
      );
    }

    // Блокеры считаются на сервере из сохранённого состояния ревью, а не берутся
    // из тела запроса: иначе утверждение мимо UI обошло бы нормоконтроль.
    // Персональное назначение на этап (#103) здесь намеренно не участвует:
    // оно не даёт права подписи, гейт выше — единственный.
    const openBlockers = decision === 'approve' ? await countOpenBlockers(pkg) : 0;

    const updated = await reviewGostPackage({
      packageId: pkg.id,
      decision,
      actorId: actorDisplayName,
      comment: comment?.trim(),
      openBlockers,
    });

    await recordInternalChangeSafe({
      calculationId: pkg.calculationId,
      author: actorDisplayName || 'reviewer',
      role: access.kind === 'staff' ? (access.session?.role ?? 'reviewer') : 'reviewer',
      docRef: `Комплект · v${pkg.version}`,
      text:
        decision === 'approve'
          ? stageBefore === 'tw'
            ? `${REVIEW_STAGE_LABELS.tw} пройдено, комплект передан на финальное ревью ГАП.`
            : 'Комплект утверждён по итогам финального ревью ГАП.'
          : `Комплект возвращён с замечаниями на этапе «${REVIEW_STAGE_LABELS[stageBefore]}».`,
      source: 'review',
      packageId: pkg.id,
    });

    await writeAudit({
      actorType: actorTypeFromAccess(access.kind),
      actorId: actorDisplayName,
      action: decision === 'approve' ? 'gost_package.approve' : 'gost_package.reject',
      entityType: 'gost_package',
      entityId: pkg.id,
      meta: {
        version: pkg.version,
        comment: comment?.trim() || null,
        status: updated.status,
        stageBefore,
        stageAfter: updated.reviewStage,
      },
      ip: clientIp(req),
    });

    if (decision === 'reject') {
      // Возврат: автору выпуска и ответственным за этапы комплекта.
      await notifySafe(async () =>
        returnedDrafts({
          pkg,
          stage: stageBefore === 'gap' ? 'gap' : 'tw',
          authorIds: [pkg.releasedBy, pkg.createdBy],
          assignments: await prisma.reviewAssignment.findMany({
            where: { packageId: pkg.id, active: true },
            select: { assigneeId: true, deputyId: true },
          }),
          actorId: access.kind === 'staff' ? (access.session?.userId ?? null) : access.actorId,
          actorName: notificationActorName(access),
          comment: comment?.trim() || null,
        }),
      );
    }

    return NextResponse.json({
      package: {
        id: updated.id,
        name: updated.name,
        version: updated.version,
        status: updated.status,
        reviewStage: updated.reviewStage,
        checksum: updated.checksum,
        approvedAt: updated.approvedAt ? updated.approvedAt.toISOString() : null,
        approvedBy: updated.approvedBy,
        reviewComment: updated.reviewComment,
        snapshot: parsePackageSnapshot(updated),
        updatedAt: updated.updatedAt.toISOString(),
      },
    });
  } catch (err) {
    // Отказ по правилам ревью — это конфликт состояния, а не сбой: 500 здесь
    // поднимал бы ложную тревогу в мониторинге при штатном ходе нормоконтроля.
    if (err instanceof GostReviewConflictError) {
      return handleApiError(err, 'Review conflict', 409);
    }
    return handleApiError(err, 'Failed to review package', 500);
  }
}
