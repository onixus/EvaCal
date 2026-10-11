import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { requireCalcAccess } from '@/lib/access';
import { CATALOG_ROLES } from '@/lib/catalog/types';
import { object, text } from '@/lib/catalog/validation';
import { createSuggestion, listSuggestions, reviewSuggestion } from '@/lib/catalog/suggestions';
import { SpecificationError } from '@/lib/specification/validation';
import { actorTypeFromAccess, clientIp, writeAudit } from '@/lib/audit';
export const dynamic = 'force-dynamic';
function errorResponse(error: unknown) {
  const status =
    error instanceof SpecificationError
      ? error.statusCode
      : error instanceof SyntaxError
        ? 400
        : 500;
  return NextResponse.json(
    { error: status === 500 ? 'Ошибка предложений каталога' : (error as Error).message },
    { status },
  );
}
/** Review queue: catalog roles only. */
export async function GET(req: NextRequest) {
  const auth = await requireApiRole(CATALOG_ROLES);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json(
      { suggestions: await listSuggestions(req.nextUrl.searchParams.get('status')) },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
/**
 * create — anyone allowed to write the calculation's specification proposes a saved
 * manual row; accept/reject — catalog roles. Proposals never change the project.
 */
export async function POST(req: NextRequest) {
  try {
    const body = object(await req.json());
    if (body.action === 'create') {
      const calculationId = text(body.calculationId, 'Расчет', 100, true);
      const access = await requireCalcAccess(req, calculationId, ['write']);
      if (access instanceof NextResponse) return access;
      const created = await createSuggestion(calculationId, body, access.actorId);
      await writeAudit({
        actorType: actorTypeFromAccess(access.kind),
        actorId: access.actorId,
        action: 'catalog.suggestion.create',
        entityType: 'catalogSuggestion',
        entityId: created.id,
        meta: { calculationId, version: created.specificationVersion },
        ip: clientIp(req),
      });
      return NextResponse.json(created, { status: 201 });
    }
    if (body.action !== 'accept' && body.action !== 'reject')
      throw new SpecificationError('Неизвестное действие');
    const auth = await requireApiRole(CATALOG_ROLES);
    if (auth instanceof NextResponse) return auth;
    const reviewed = await reviewSuggestion(body, auth.userId);
    await writeAudit({
      actorType: 'user',
      actorId: auth.userId,
      action: `catalog.suggestion.${body.action}`,
      entityType: 'catalogSuggestion',
      entityId: reviewed.id,
      meta: { createdProductId: reviewed.createdProductId, offerId: reviewed.offerId },
      ip: clientIp(req),
    });
    return NextResponse.json(reviewed, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
