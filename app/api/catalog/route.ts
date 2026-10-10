import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { CATALOG_ROLES } from '@/lib/catalog/types';
import { loadCatalog, mutateCatalog } from '@/lib/catalog/store';
import { SpecificationError } from '@/lib/specification/validation';
import { clientIp, writeAudit } from '@/lib/audit';
export const dynamic = 'force-dynamic';
function errorResponse(error: unknown) {
  const status =
    error instanceof SpecificationError
      ? error.statusCode
      : error instanceof SyntaxError
        ? 400
        : 500;
  return NextResponse.json(
    { error: status === 500 ? 'Ошибка каталога' : (error as Error).message },
    { status },
  );
}
export async function GET() {
  const auth = await requireApiRole(CATALOG_ROLES);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json(await loadCatalog());
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(req: NextRequest) {
  const auth = await requireApiRole(CATALOG_ROLES);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json();
    const result = await mutateCatalog(body, auth.userId);
    await writeAudit({
      actorType: 'user',
      actorId: auth.userId,
      action: `catalog.${body.action}`,
      entityType: 'catalog',
      entityId: result.id,
      ip: clientIp(req),
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
