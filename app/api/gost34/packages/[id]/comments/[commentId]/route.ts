import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireCalcAccess, type AccessContext } from '@/lib/access';
import { actorTypeFromAccess, clientIp, writeAudit } from '@/lib/audit';
import { handleApiError } from '@/lib/apiHelpers';
import { loadReviewComments, serializeComment } from '@/lib/review/store';
import {
  actorFromAccess,
  checkCommentTransition,
  isApprovedPackage,
  COMMENT_ACTION_TARGET,
  COMMENT_ACTIONS,
  type CommentAction,
  type CommentRuleSubject,
} from '@/lib/review/workflow';
import type { CommentStatus } from '@/lib/gost34/review/types';

type Props = { params: Promise<{ id: string; commentId: string }> };

const COMMENT_INCLUDE = {
  package: {
    select: {
      version: true,
      calculationId: true,
      documentTypes: true,
      status: true,
      reviewStage: true,
    },
  },
  replies: { orderBy: { createdAt: 'asc' as const } },
};

/**
 * Комплект из адреса — контекст, в котором действует пользователь (обычно
 * новая версия), замечание — его или одной из ранних версий той же линии.
 * Доступ проверяется по комплекту из адреса; замечание должно быть видно в
 * нём по тем же правилам переноса, что и на экране ревью, иначе — 404.
 * Неизменяемость проверяется и для комплекта из адреса, и для собственного
 * комплекта замечания.
 */
async function load(
  req: NextRequest,
  props: Props,
): Promise<
  | NextResponse
  | {
      access: AccessContext;
      pkg: NonNullable<Awaited<ReturnType<typeof prisma.gostPackage.findUnique>>>;
      comment: NonNullable<Awaited<ReturnType<typeof findComment>>>;
    }
> {
  const { id, commentId } = await props.params;
  const pkg = await prisma.gostPackage.findUnique({ where: { id } });
  if (!pkg) return NextResponse.json({ error: 'Пакет документов не найден' }, { status: 404 });

  const access = await requireCalcAccess(req, pkg.calculationId, ['review']);
  if (access instanceof NextResponse) return access;

  const comment = await findComment(commentId);
  const visible =
    comment && (await loadReviewComments(pkg)).some((c) => c.id === comment.id && !c.legacy);
  if (!comment || !visible) {
    return NextResponse.json({ error: 'Замечание не найдено' }, { status: 404 });
  }
  if (isApprovedPackage(pkg) || isApprovedPackage(comment.package)) {
    return NextResponse.json({ error: 'Утверждённый комплект неизменяем' }, { status: 409 });
  }
  return { access, pkg, comment };
}

function findComment(id: string) {
  return prisma.reviewComment.findUnique({ where: { id }, include: COMMENT_INCLUDE });
}

/**
 * Смена состояния замечания: `fix` (исправлено в более новой версии),
 * `verify` (проверено), `reject` (отклонено), `reopen` (исправление не
 * принято). Закрыть замечание вправе только автор или роль этапа.
 */
export async function PATCH(req: NextRequest, props: Props) {
  try {
    const loaded = await load(req, props);
    if (loaded instanceof NextResponse) return loaded;
    const { access, pkg, comment } = loaded;

    const body = await req.json().catch(() => ({}));
    const action = body?.action as CommentAction;
    if (!COMMENT_ACTIONS.includes(action)) {
      return NextResponse.json(
        { error: `Параметр action: ${COMMENT_ACTIONS.join(' | ')}` },
        { status: 400 },
      );
    }

    // По умолчанию исправление фиксируется в комплекте, из которого действуют.
    const fixedInId = action === 'fix' ? String(body?.fixedInPackageId || pkg.id) : null;
    const fixedIn = fixedInId
      ? fixedInId === pkg.id
        ? pkg
        : await prisma.gostPackage.findUnique({ where: { id: fixedInId } })
      : null;

    const actor = actorFromAccess(access);
    const subject: CommentRuleSubject = {
      status: comment.status as CommentStatus,
      stage: comment.stage === 'gap' ? 'gap' : 'tw',
      author: comment.author,
      authorId: comment.authorId,
      packageVersion: comment.package.version,
      packageLine: comment.package,
      legacy: comment.legacy,
    };
    const rule = checkCommentTransition({ subject, action, actor, fixedIn });
    if (!rule.ok) return NextResponse.json({ error: rule.error }, { status: rule.status });

    const who = actor.username || actor.actorId;
    const now = new Date();
    const data =
      action === 'fix'
        ? {
            status: 'fixed',
            fixedBy: who,
            fixedAt: now,
            fixedInPackageId: fixedIn!.id,
            fixedInVersion: fixedIn!.version,
          }
        : action === 'verify'
          ? { status: 'verified', verifiedBy: who, verifiedAt: now }
          : action === 'reject'
            ? { status: 'rejected' }
            : // Возврат в работу: ссылка на «исправленную» версию снимается,
              // иначе замечание выглядело бы исправленным.
              {
                status: 'open',
                fixedBy: null,
                fixedAt: null,
                fixedInPackageId: null,
                fixedInVersion: null,
              };

    // Условие на прежнее состояние защищает от гонки двух проверяющих.
    const result = await prisma.reviewComment.updateMany({
      where: { id: comment.id, status: comment.status },
      data,
    });
    if (result.count === 0) {
      return NextResponse.json(
        { error: 'Замечание изменено другим пользователем, обновите страницу' },
        { status: 409 },
      );
    }

    await writeAudit({
      actorType: actorTypeFromAccess(access.kind),
      actorId: actor.actorId,
      action: `review_comment.${action}`,
      entityType: 'gost_package',
      entityId: comment.packageId,
      meta: {
        commentId: comment.id,
        from: comment.status,
        to: COMMENT_ACTION_TARGET[action],
        contextPackageId: pkg.id,
        fixedInPackageId: fixedIn?.id ?? null,
      },
      ip: clientIp(req),
    });

    return NextResponse.json({ comment: serializeComment((await findComment(comment.id))!) });
  } catch (err) {
    return handleApiError(err, 'Failed to update review comment', 500);
  }
}

/** Ответ в ветке замечания: пояснение исправления или возражение. */
export async function POST(req: NextRequest, props: Props) {
  try {
    const loaded = await load(req, props);
    if (loaded instanceof NextResponse) return loaded;
    const { access, comment } = loaded;

    const body = await req.json().catch(() => ({}));
    const text = String(body?.text ?? '')
      .trim()
      .slice(0, 2000);
    if (!text) return NextResponse.json({ error: 'Пустой ответ' }, { status: 400 });

    const actor = actorFromAccess(access);
    const author =
      access.kind === 'staff'
        ? actor.username || actor.actorId
        : String(body?.author ?? '')
            .trim()
            .slice(0, 200) || 'Согласующий Заказчика';

    await prisma.reviewCommentReply.create({
      data: { commentId: comment.id, text, author, authorId: actor.actorId },
    });

    await writeAudit({
      actorType: actorTypeFromAccess(access.kind),
      actorId: actor.actorId,
      action: 'review_comment.reply',
      entityType: 'gost_package',
      entityId: comment.packageId,
      meta: { commentId: comment.id },
      ip: clientIp(req),
    });

    return NextResponse.json(
      { comment: serializeComment((await findComment(comment.id))!) },
      { status: 201 },
    );
  } catch (err) {
    return handleApiError(err, 'Failed to reply to review comment', 500);
  }
}
