import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiRole } from '@/lib/auth';
import { clientIp, writeAudit } from '@/lib/audit';
import { CommercialContourError, loadCommercialState } from '@/lib/commercialContourData';
import { contourError } from '@/lib/commercialContourHttp';
import { DISCOUNT_DECIDE_ROLES, DISCOUNT_REQUEST_ROLES } from '@/lib/discountApproval';

type Params = { params: Promise<{ id: string; approvalId: string }> };

/**
 * Решение по заявке (#103 §4.3): `approved`/`rejected` — архитектор или
 * администратор, не автор заявки; `withdrawn` — автор или администратор.
 * Согласовать можно только при неизменных условиях КП (скидка и маржа).
 */
export async function PATCH(req: NextRequest, props: Params) {
  const auth = await requireApiRole(DISCOUNT_REQUEST_ROLES);
  if (auth instanceof NextResponse) return auth;
  const { id, approvalId } = await props.params;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const decision = body.decision;
    if (decision !== 'approved' && decision !== 'rejected' && decision !== 'withdrawn')
      throw new CommercialContourError('Решение: approved, rejected или withdrawn');
    const comment =
      typeof body.comment === 'string' && body.comment.trim()
        ? body.comment.trim().slice(0, 2000)
        : null;
    const approval = await prisma.discountApproval.findUnique({ where: { id: approvalId } });
    if (!approval || approval.calculationId !== id)
      throw new CommercialContourError('Заявка не найдена', 404);
    if (approval.status !== 'pending')
      throw new CommercialContourError('Заявка уже рассмотрена или отозвана', 409);

    if (decision === 'withdrawn') {
      if (approval.requestedBy !== auth.username && auth.role !== 'admin')
        throw new CommercialContourError('Отозвать может автор заявки или администратор', 403);
    } else {
      if (!DISCOUNT_DECIDE_ROLES.includes(auth.role))
        throw new CommercialContourError('Решение принимает архитектор или администратор', 403);
      if (approval.requestedBy === auth.username)
        throw new CommercialContourError('Нельзя согласовать собственную заявку', 403);
      if (decision === 'approved') {
        const state = await loadCommercialState(id);
        if (!state) throw new CommercialContourError('Расчёт не найден', 404);
        const sameDiscount = Math.abs(state.discountPercent - approval.requestedPercent) < 1e-9;
        const sameMargin =
          approval.resultingMargin === null
            ? state.gate.margin === null
            : state.gate.margin !== null &&
              Math.abs(state.gate.margin - approval.resultingMargin) < 0.005;
        if (!sameDiscount || !sameMargin)
          throw new CommercialContourError(
            'Условия КП изменились после заявки — запросите согласование заново',
            409,
          );
      }
    }

    const updated = await prisma.discountApproval.update({
      where: { id: approvalId },
      data: {
        status: decision,
        ...(decision === 'withdrawn'
          ? {}
          : { decidedBy: auth.username, decidedAt: new Date(), decisionComment: comment }),
      },
    });
    await writeAudit({
      actorType: 'user',
      actorId: auth.userId,
      action: `discount_approval.${decision}`,
      entityType: 'calculation',
      entityId: id,
      meta: { approvalId, requestedPercent: approval.requestedPercent, comment },
      ip: clientIp(req),
    });
    return NextResponse.json(updated);
  } catch (error) {
    return contourError(error);
  }
}
