import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiRole } from '@/lib/auth';
import { clientIp, writeAudit } from '@/lib/audit';
import {
  CommercialContourError,
  parseCostItemInput,
  requireEditableCalculation,
} from '@/lib/commercialContourData';
import { COMMERCIAL_EDIT_ROLES, contourError } from '@/lib/commercialContourHttp';

type Params = { params: Promise<{ id: string; itemId: string }> };

async function requireItem(calculationId: string, itemId: string) {
  const item = await prisma.costItem.findUnique({ where: { id: itemId } });
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
    const calc = await requireEditableCalculation(id);
    await requireItem(id, itemId);
    const data = parseCostItemInput(await req.json().catch(() => null), calc.currency);
    await prisma.costItem.update({ where: { id: itemId }, data });
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
    await requireEditableCalculation(id);
    const item = await requireItem(id, itemId);
    await prisma.costItem.delete({ where: { id: itemId } });
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
