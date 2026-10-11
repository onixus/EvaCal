import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiRole } from '@/lib/auth';
import { clientIp, writeAudit } from '@/lib/audit';
import {
  CommercialContourError,
  loadCommercialState,
  loadPinnedSpecification,
  requireEditableCalculation,
} from '@/lib/commercialContourData';
import {
  COMMERCIAL_EDIT_ROLES,
  COMMERCIAL_VIEW_ROLES,
  contourError,
} from '@/lib/commercialContourHttp';

/**
 * Коммерческий контур расчёта (#103 §4.2–4.3): итог КП с поставкой и статьями
 * затрат, пояснения, порог маржи и состояние согласования скидки.
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(COMMERCIAL_VIEW_ROLES);
  if (auth instanceof NextResponse) return auth;
  const { id } = await props.params;
  try {
    const state = await loadCommercialState(id);
    if (!state) return NextResponse.json({ error: 'Расчёт не найден' }, { status: 404 });
    return NextResponse.json({ ...state, viewer: { username: auth.username, role: auth.role } });
  } catch (error) {
    return contourError(error);
  }
}

/** Закрепить подтверждённую редакцию спецификации в КП (null — без поставки). */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(COMMERCIAL_EDIT_ROLES);
  if (auth instanceof NextResponse) return auth;
  const { id } = await props.params;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (!('pinnedSpecificationVersion' in body))
      throw new CommercialContourError('Нечего обновлять');
    const raw = body.pinnedSpecificationVersion;
    if (raw !== null && (!Number.isSafeInteger(raw) || (raw as number) < 1))
      throw new CommercialContourError('Редакция спецификации: целое число ≥ 1 или null');
    await requireEditableCalculation(id);
    const version = raw as number | null;
    await loadPinnedSpecification(id, version);
    await prisma.calculation.update({
      where: { id },
      data: { pinnedSpecificationVersion: version },
    });
    await writeAudit({
      actorType: 'user',
      actorId: auth.userId,
      action: 'calculation.pin_specification',
      entityType: 'calculation',
      entityId: id,
      meta: { pinnedSpecificationVersion: version },
      ip: clientIp(req),
    });
    return NextResponse.json(await loadCommercialState(id));
  } catch (error) {
    return contourError(error);
  }
}
