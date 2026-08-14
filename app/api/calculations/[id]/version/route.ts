import { NextRequest, NextResponse } from 'next/server';
import { requireCalcAccess } from '@/lib/access';
import { actorTypeFromAccess, clientIp, writeAudit } from '@/lib/audit';
import { createCalculationVersion } from '@/lib/project';

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const access = await requireCalcAccess(req, params.id, ['write']);
  if (access instanceof NextResponse) return access;

  const body = await req.json().catch(() => ({}));
  const { versionComment, name, answers } = body;

  try {
    const createdBy =
      access.kind === 'staff'
        ? access.session?.username || access.actorId
        : access.kind === 'share'
          ? 'presale-share'
          : 'presale';

    const newVersion = await createCalculationVersion({
      parentCalculationId: params.id,
      versionComment,
      name,
      answers,
      createdBy,
    });

    if (!newVersion) {
      return NextResponse.json({ error: 'Calculation not found' }, { status: 404 });
    }

    await writeAudit({
      actorType: actorTypeFromAccess(access.kind),
      actorId: access.actorId,
      action: 'calculation.version.create',
      entityType: 'calculation',
      entityId: newVersion.id,
      meta: {
        parentCalculationId: params.id,
        version: newVersion.version,
        projectId: newVersion.projectId,
      },
      ip: clientIp(req),
    });

    return NextResponse.json(
      {
        id: newVersion.id,
        version: newVersion.version,
        projectId: newVersion.projectId,
        name: newVersion.name,
        status: newVersion.status,
      },
      { status: 201 },
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to create calculation version' },
      { status: 400 },
    );
  }
}
