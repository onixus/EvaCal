import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { requireCalcAccess } from '@/lib/access';
import { CATALOG_ROLES } from '@/lib/catalog/types';
import { object } from '@/lib/catalog/validation';
import { applyReplacement, previewReplacements } from '@/lib/specification/replacements';
import { SpecificationError } from '@/lib/specification/validation';
import { clientIp, writeAudit } from '@/lib/audit';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
function errorResponse(error: unknown) {
  const status =
    error instanceof SpecificationError
      ? error.statusCode
      : error instanceof SyntaxError
        ? 400
        : 500;
  return NextResponse.json(
    { error: status === 500 ? 'Ошибка замены позиции' : (error as Error).message },
    { status },
  );
}
/** Catalog staff with write access to the calculation (same gate as GPL updates). */
async function gate(req: NextRequest, context: Context) {
  const auth = await requireApiRole(CATALOG_ROLES);
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params,
    access = await requireCalcAccess(req, id, ['write']);
  if (access instanceof NextResponse) return access;
  if (access.kind !== 'staff')
    return NextResponse.json({ error: 'Требуется доступ сотрудника' }, { status: 403 });
  return { id, actorId: auth.userId };
}
export async function GET(req: NextRequest, context: Context) {
  try {
    const access = await gate(req, context);
    if (access instanceof NextResponse) return access;
    return NextResponse.json(await previewReplacements(access.id), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(req: NextRequest, context: Context) {
  try {
    const access = await gate(req, context);
    if (access instanceof NextResponse) return access;
    const body = object(await req.json());
    const saved = await applyReplacement(access.id, body, access.actorId);
    await writeAudit({
      actorType: 'user',
      actorId: access.actorId,
      action: 'specification.catalog.replace',
      entityType: 'calculation',
      entityId: access.id,
      meta: {
        version: saved.snapshot.version,
        itemId: body.itemId,
        relationId: body.relationId,
      },
      ip: clientIp(req),
    });
    return NextResponse.json(saved, {
      status: 201,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
