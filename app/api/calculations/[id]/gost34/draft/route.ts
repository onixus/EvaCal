import { NextRequest, NextResponse } from 'next/server';
import { requireCalcAccess } from '@/lib/access';
import { actorTypeFromAccess, clientIp, writeAudit } from '@/lib/audit';
import { getGostPackageDraft, getGostPackageStudioState, saveGostPackageDraft } from '@/lib/project';
import { parsePackageSnapshot } from '@/lib/gost34/diff';
import { parseChecklist, parseComments } from '@/lib/gost34/review/types';
import { handleApiError } from '@/lib/apiHelpers';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const params = await props.params;
    const access = await requireCalcAccess(req, params.id, ['read']);
    if (access instanceof NextResponse) return access;

    const { draft, latestPackage } = await getGostPackageStudioState(params.id);

    // Если есть активный черновик и он не старше последнего пакета — берём его.
    // Если черновика нет или он устарел по отношению к отклонённому комплекту,
    // базой для правок становится сам отклонённый комплект.
    const effectiveDraft =
      draft && (!latestPackage || draft.version >= latestPackage.version)
        ? draft
        : latestPackage?.status === 'rejected'
          ? latestPackage
          : draft;

    return NextResponse.json({
      draft: effectiveDraft
        ? {
            id: effectiveDraft.id,
            version: effectiveDraft.version,
            name: effectiveDraft.name,
            status: effectiveDraft.status,
            standardProfileId: effectiveDraft.standardProfileId,
            standardProfileVersion: effectiveDraft.standardProfileVersion,
            generatorVersion: effectiveDraft.generatorVersion,
            snapshot: parsePackageSnapshot(effectiveDraft),
            updatedAt: effectiveDraft.updatedAt.toISOString(),
          }
        : null,
      latestPackage: latestPackage
        ? {
            id: latestPackage.id,
            version: latestPackage.version,
            name: latestPackage.name,
            status: latestPackage.status,
            reviewStage: latestPackage.reviewStage,
            reviewComment: latestPackage.reviewComment,
            reviewComments: parseComments(latestPackage.reviewComments),
            reviewChecklist: parseChecklist(latestPackage.reviewChecklist),
            twVersion: latestPackage.twVersionPath
              ? {
                  name: latestPackage.twVersionName || 'версия тех.писателя.docx',
                  uploadedAt: latestPackage.twVersionUploadedAt
                    ? latestPackage.twVersionUploadedAt.toISOString()
                    : null,
                  uploadedBy: latestPackage.twVersionUploadedBy,
                  isPriority: latestPackage.twVersionIsPriority,
                }
              : null,
            releasedAt: latestPackage.releasedAt ? latestPackage.releasedAt.toISOString() : null,
            updatedAt: latestPackage.updatedAt.toISOString(),
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
