import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { clientIp, writeAudit } from '@/lib/audit';
import {
  CommercialContourError,
  loadCommercialState,
  requireEditableCalculation,
  withCommercialLock,
} from '@/lib/commercialContourData';
import { contourError } from '@/lib/commercialContourHttp';
import { DISCOUNT_REQUEST_ROLES } from '@/lib/discountApproval';

/**
 * Заявка на согласование скидки (#103 §4.3): фиксирует текущую скидку, маржу,
 * порог и отпечаток условий КП. Прежняя ожидающая заявка расчёта отзывается.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(DISCOUNT_REQUEST_ROLES);
  if (auth instanceof NextResponse) return auth;
  const { id } = await props.params;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const comment =
      typeof body.comment === 'string' && body.comment.trim()
        ? body.comment.trim().slice(0, 2000)
        : null;
    const created = await withCommercialLock(id, async (tx) => {
      await requireEditableCalculation(id, tx);
      const state = await loadCommercialState(id, tx);
      if (!state) throw new CommercialContourError('Расчёт не найден', 404);
      if (!state.gate.requiresApproval || state.minMarginPercent === null)
        throw new CommercialContourError('Согласование не требуется: маржа не ниже порога', 409);
      if (state.gate.approved)
        throw new CommercialContourError('Скидка при текущих условиях уже согласована', 409);
      await tx.discountApproval.updateMany({
        where: { calculationId: id, status: 'pending' },
        data: { status: 'withdrawn' },
      });
      return tx.discountApproval.create({
        data: {
          calculationId: id,
          requestedPercent: state.discountPercent,
          resultingMargin: state.gate.margin,
          minMarginPercent: state.minMarginPercent,
          termsFingerprint: state.fingerprint,
          requestedBy: auth.username,
          comment,
        },
      });
    });
    await writeAudit({
      actorType: 'user',
      actorId: auth.userId,
      action: 'discount_approval.request',
      entityType: 'calculation',
      entityId: id,
      meta: {
        approvalId: created.id,
        requestedPercent: created.requestedPercent,
        resultingMargin: created.resultingMargin,
        minMarginPercent: created.minMarginPercent,
      },
      ip: clientIp(req),
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return contourError(error);
  }
}
