import { NextRequest, NextResponse } from 'next/server';
import { requireCalcAccess } from '@/lib/access';
import { actorTypeFromAccess, clientIp, writeAudit } from '@/lib/audit';
import { getGostPackageDraft, saveGostPackageDraft } from '@/lib/project';
import { parsePackageSnapshot } from '@/lib/gost34/diff';
import { handleApiError } from '@/lib/apiHelpers';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const params = await props.params;
    const access = await requireCalcAccess(req, params.id, ['read']);
    if (access instanceof NextResponse) return access;

    const draft = await getGostPackageDraft(params.id);

    return NextResponse.json({
      draft: draft
        ? {
            id: draft.id,
            version: draft.version,
            name: draft.name,
            status: draft.status,
            standardProfileId: draft.standardProfileId,
            standardProfileVersion: draft.standardProfileVersion,
            generatorVersion: draft.generatorVersion,
            snapshot: parsePackageSnapshot(draft),
            updatedAt: draft.updatedAt.toISOString(),
          }
        : null,
    });
  } catch (err) {
    return handleApiError(err, 'Failed to get draft snapshot', 500);
  }
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const params = await props.params;
    const access = await requireCalcAccess(req, params.id, ['write']);
    if (access instanceof NextResponse) return access;

    const body = await req.json();
    const { snapshot, standardProfileId, standardProfileVersion, generatorVersion } = body;

    if (!snapshot) {
      return NextResponse.json({ error: 'snapshot is required' }, { status: 400 });
    }

    const draft = await saveGostPackageDraft({
      calculationId: params.id,
      snapshot,
      standardProfileId,
      standardProfileVersion,
      generatorVersion,
      createdBy: access.actorId,
    });

    await writeAudit({
      actorType: actorTypeFromAccess(access.kind),
      actorId: access.actorId,
      action: 'gost_package.draft_save',
      entityType: 'gost_package',
      entityId: draft.id,
      meta: { calculationId: params.id },
      ip: clientIp(req),
    });

    return NextResponse.json({
      draft: {
        id: draft.id,
        version: draft.version,
        name: draft.name,
        status: draft.status,
        snapshot: parsePackageSnapshot(draft),
        updatedAt: draft.updatedAt.toISOString(),
      },
    });
  } catch (err) {
    return handleApiError(err, 'Failed to save draft snapshot', 500);
  }
}
