import { NextRequest, NextResponse } from 'next/server';
import { clientIp, writeAudit } from '@/lib/audit';
import { kitFailure, readJson, requireKitApplicationRole } from '@/lib/kitApplication/http';
import { parseVersionParam } from '@/lib/solutionKits/http';
import { applyKitUpdate } from '@/lib/kitApplication/store';
import { parseDriverValues } from '@/lib/kitApplication/plan';

type Params = { params: Promise<{ id: string }> };

/**
 * Перенос выбранных изменений новой версии набора: `{ kitId, toVersion,
 * elementIds, driverValues? }`. Всегда создаёт новую черновую версию расчёта
 * (и черновик комплекта при нём); исходные версии не меняются.
 */
export async function POST(req: NextRequest, props: Params) {
  const auth = await requireKitApplicationRole();
  if (auth instanceof NextResponse) return auth;
  const { id } = await props.params;
  const body = await readJson(req);
  if (body instanceof NextResponse) return body;
  const kitId = typeof body.kitId === 'string' ? body.kitId : '';
  const toVersion = parseVersionParam(String(body.toVersion ?? ''));
  const elementIds = body.elementIds;
  if (
    !kitId ||
    !toVersion ||
    !Array.isArray(elementIds) ||
    elementIds.length > 5000 ||
    elementIds.some((x) => typeof x !== 'string')
  ) {
    return NextResponse.json(
      { error: 'Ожидается { kitId, toVersion, elementIds: string[] }' },
      { status: 400 },
    );
  }
  const drivers = parseDriverValues(body.driverValues);
  if (typeof drivers === 'string') return NextResponse.json({ error: drivers }, { status: 400 });
  const result = await applyKitUpdate(
    { username: auth.username },
    {
      calculationId: id,
      kitId,
      toVersion,
      elementIds: elementIds as string[],
      driverValues: drivers,
    },
  );
  if (!result.ok) return kitFailure(result);
  await writeAudit({
    actorType: 'user',
    actorId: auth.userId,
    action: 'calculation.kit.update',
    entityType: 'calculation',
    entityId: result.calculationId,
    meta: {
      sourceCalculationId: id,
      kitId,
      toVersion,
      elementIds,
      applicationId: result.applicationId,
      packageId: result.packageId,
    },
    ip: clientIp(req),
  });
  return NextResponse.json(result, { status: 201 });
}
