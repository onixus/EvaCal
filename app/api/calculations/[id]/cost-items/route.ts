import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { clientIp, writeAudit } from '@/lib/audit';
import {
  loadCostItems,
  parseCostItemInput,
  requireEditableCalculation,
  withCommercialLock,
} from '@/lib/commercialContourData';
import {
  COMMERCIAL_EDIT_ROLES,
  COMMERCIAL_VIEW_ROLES,
  contourError,
} from '@/lib/commercialContourHttp';

/** Дополнительные статьи затрат расчёта (#103 §4.2). */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(COMMERCIAL_VIEW_ROLES);
  if (auth instanceof NextResponse) return auth;
  const { id } = await props.params;
  try {
    return NextResponse.json({ costItems: await loadCostItems(id) });
  } catch (error) {
    return contourError(error);
  }
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(COMMERCIAL_EDIT_ROLES);
  if (auth instanceof NextResponse) return auth;
  const { id } = await props.params;
  try {
    const body = await req.json().catch(() => null);
    const { created, data } = await withCommercialLock(id, async (tx) => {
      const calc = await requireEditableCalculation(id, tx);
      const data = parseCostItemInput(body, calc.currency);
      const created = await tx.costItem.create({ data: { ...data, calculationId: id } });
      return { created, data };
    });
    await writeAudit({
      actorType: 'user',
      actorId: auth.userId,
      action: 'cost_item.create',
      entityType: 'calculation',
      entityId: id,
      meta: { costItemId: created.id, kind: data.kind, specItemRef: data.specItemRef ?? null },
      ip: clientIp(req),
    });
    return NextResponse.json({ id: created.id }, { status: 201 });
  } catch (error) {
    return contourError(error);
  }
}
