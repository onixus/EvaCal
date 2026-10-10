import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireCalcAccess } from '@/lib/access';
import { actorTypeFromAccess, clientIp, writeAudit } from '@/lib/audit';
import { handleApiError } from '@/lib/apiHelpers';
import type { CommentSeverity } from '@/lib/gost34/review/types';
import { loadReviewComments, serializeComment } from '@/lib/review/store';
import { actorFromAccess } from '@/lib/review/workflow';

const SEVERITIES: CommentSeverity[] = ['blocker', 'remark', 'suggestion'];

/** Замечания комплекта, включая незакрытые замечания ранних версий линии. */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await props.params;
    const pkg = await prisma.gostPackage.findUnique({ where: { id } });
    if (!pkg) return NextResponse.json({ error: 'Пакет документов не найден' }, { status: 404 });

    const access = await requireCalcAccess(req, pkg.calculationId, ['read']);
    if (access instanceof NextResponse) return access;

    return NextResponse.json({ comments: await loadReviewComments(pkg) });
  } catch (err) {
    return handleApiError(err, 'Failed to load review comments', 500);
  }
}

/**
 * Новое замечание к разделу. Автора проставляет сервер: подписать замечание
 * чужим именем нельзя. Этап берётся из комплекта — его роль потом вправе
 * замечание проверить.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await props.params;
    const pkg = await prisma.gostPackage.findUnique({ where: { id } });
    if (!pkg) return NextResponse.json({ error: 'Пакет документов не найден' }, { status: 404 });

    const access = await requireCalcAccess(req, pkg.calculationId, ['review']);
    if (access instanceof NextResponse) return access;

    if (pkg.status === 'approved' || pkg.reviewStage === 'done') {
      return NextResponse.json({ error: 'Утверждённый комплект неизменяем' }, { status: 409 });
    }

    const body = await req.json().catch(() => ({}));
    const sectionId = String(body?.sectionId ?? '')
      .trim()
      .slice(0, 200);
    const text = String(body?.text ?? '')
      .trim()
      .slice(0, 2000);
    if (!sectionId || !text) {
      return NextResponse.json({ error: 'Укажите раздел и текст замечания' }, { status: 400 });
    }
    const severity: CommentSeverity = SEVERITIES.includes(body?.severity)
      ? body.severity
      : 'remark';

    const actor = actorFromAccess(access);
    // Гость по ссылке может представиться (ФИО согласующего); сотрудник
    // подписывается логином сессии.
    const author =
      access.kind === 'staff'
        ? actor.username || actor.actorId
        : String(body?.author ?? '')
            .trim()
            .slice(0, 200) || 'Согласующий Заказчика';

    const row = await prisma.reviewComment.create({
      data: {
        packageId: pkg.id,
        stage: pkg.reviewStage === 'gap' ? 'gap' : 'tw',
        sectionId,
        severity,
        text,
        author,
        authorId: actor.actorId,
      },
      include: { package: { select: { version: true } }, replies: true },
    });

    await writeAudit({
      actorType: actorTypeFromAccess(access.kind),
      actorId: actor.actorId,
      action: 'review_comment.create',
      entityType: 'gost_package',
      entityId: pkg.id,
      meta: { commentId: row.id, severity, sectionId },
      ip: clientIp(req),
    });

    return NextResponse.json({ comment: serializeComment(row) }, { status: 201 });
  } catch (err) {
    return handleApiError(err, 'Failed to create review comment', 500);
  }
}
