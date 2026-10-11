import { NextRequest, NextResponse } from 'next/server';
import { clientIp, writeAudit } from '@/lib/audit';
import {
  kitFailure,
  kitTarget,
  readJson,
  requireKitApplicationRole,
} from '@/lib/kitApplication/http';
import { parseSelection } from '@/lib/kitApplication/plan';
import { applyKit } from '@/lib/kitApplication/store';

type Params = { params: Promise<{ id: string }> };

/**
 * Применение утверждённой версии набора: `{ kitId, version?, selection,
 * createVersion? }`. Только черновик расчёта (иначе 409 или новая версия при
 * `createVersion: true`) и черновик комплекта.
 */
export async function POST(req: NextRequest, props: Params) {
  const auth = await requireKitApplicationRole();
  if (auth instanceof NextResponse) return auth;
  const { id } = await props.params;
  const body = await readJson(req);
  if (body instanceof NextResponse) return body;
  const target = kitTarget(body);
  if (target instanceof NextResponse) return target;
  const selection = parseSelection(body.selection);
  if (typeof selection === 'string') {
    return NextResponse.json({ error: selection }, { status: 400 });
  }
  const result = await applyKit(
    { username: auth.username },
    { calculationId: id, ...target, selection, createVersion: body.createVersion === true },
  );
  if (!result.ok) return kitFailure(result);
  // Пустой план (повтор, всё исключено) — ничего не записано.
  if (result.noop) return NextResponse.json(result, { status: 200 });
  await writeAudit({
    actorType: 'user',
    actorId: auth.userId,
    action: 'calculation.kit.apply',
    entityType: 'calculation',
    entityId: result.calculationId,
    meta: {
      sourceCalculationId: id,
      kitId: target.kitId,
      version: target.version ?? null,
      applicationId: result.applicationId,
      packageId: result.packageId,
    },
    ip: clientIp(req),
  });
  return NextResponse.json(result, { status: 201 });
}
