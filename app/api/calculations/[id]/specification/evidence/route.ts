import { NextRequest, NextResponse } from 'next/server';
import { requireCalcAccess } from '@/lib/access';
import { CATALOG_ROLES } from '@/lib/catalog/types';
import { refreshSpecificationEvidence } from '@/lib/specification/evidence-refresh';
import { SpecificationError } from '@/lib/specification/validation';
import { handleApiError } from '@/lib/apiHelpers';
import { actorTypeFromAccess, clientIp, writeAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';
type Params = { params: Promise<{ id: string }> };

/**
 * «Обновить сведения реестров»: anyone allowed to write the specification. The evidence
 * comes from the catalog on the server; the request only names the version and rows.
 */
export async function POST(req: NextRequest, props: Params) {
  try {
    const { id } = await props.params;
    const access = await requireCalcAccess(req, id, ['write']);
    if (access instanceof NextResponse) return access;
    const body = await req.json();
    const saved = await refreshSpecificationEvidence(id, body, access.actorId, {
      allowNewCatalogOrigins:
        access.kind === 'staff' && CATALOG_ROLES.includes(access.session?.role || ''),
    });
    await writeAudit({
      actorType: actorTypeFromAccess(access.kind),
      actorId: access.actorId,
      action: 'specification.evidence.refresh',
      entityType: 'calculation',
      entityId: id,
      meta: { version: saved.snapshot.version, itemIds: body?.itemIds ?? 'all' },
      ip: clientIp(req),
    });
    return NextResponse.json(saved, { status: 201 });
  } catch (error) {
    return handleApiError(
      error,
      'Не удалось обновить сведения реестров',
      error instanceof SpecificationError
        ? error.statusCode
        : error instanceof SyntaxError
          ? 400
          : 500,
    );
  }
}
