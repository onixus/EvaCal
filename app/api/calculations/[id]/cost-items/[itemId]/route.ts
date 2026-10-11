import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { clientIp, writeAudit } from '@/lib/audit';
import {
  CommercialContourError,
  parseCostItemInput,
  requireEditableCalculation,
  withCommercialLock,
} from '@/lib/commercialContourData';
import type { Prisma } from '@/lib/generated/prisma/client';
import { COMMERCIAL_EDIT_ROLES, contourError } from '@/lib/commercialContourHttp';

type Params = { params: Promise<{ id: string; itemId: string }> };

async function requireItem(calculationId: string, itemId: string, db: Prisma.TransactionClient) {
  const item = await db.costItem.findUnique({ where: { id: itemId } });
  if (!item || item.calculationId !== calculationId)
    throw new CommercialContourError('Статья не найдена', 404);
  return item;
}

/** Замена статьи целиком (все поля передаются заново). */
export async function PUT(req: NextRequest, props: Params) {
  const auth = await requireApiRole(COMMERCIAL_EDIT_ROLES);
  if (auth instanceof NextResponse) return auth;
  const { id, itemId } = await props.params;
  try {
    const body = await req.json().catch(() => null);
    await withCommercialLock(id, async (tx) => {
      const calc = await requireEditableCalculation(id, tx);
      await requireItem(id, itemId, tx);
      const data = parseCostItemInput(body, calc.currency);
      await tx.costItem.update({ where: { id: itemId }, data });
    });
    await writeAudit({
      actorType: 'user',
      actorId: auth.userId,
      action: 'cost_item.update',
      entityType: 'calculation',
      entityId: id,
      meta: { costItemId: itemId },
      ip: clientIp(req),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return contourError(error);
  }
}

export async function DELETE(req: NextRequest, props: Params) {
  const auth = await requireApiRole(COMMERCIAL_EDIT_ROLES);
  if (auth instanceof NextResponse) return auth;
  const { id, itemId } = await props.params;
  try {
    const item = await withCommercialLock(id, async (tx) => {
      await requireEditableCalculation(id, tx);
      const item = await requireItem(id, itemId, tx);
      await tx.costItem.delete({ where: { id: itemId } });
      return item;
    });
    await writeAudit({
      actorType: 'user',
      actorId: auth.userId,
      action: 'cost_item.delete',
      entityType: 'calculation',
      entityId: id,
      meta: { costItemId: itemId, description: item.description },
      ip: clientIp(req),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return contourError(error);
  }
}
