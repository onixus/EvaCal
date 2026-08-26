import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireCalcAccess } from '@/lib/access';
import { actorTypeFromAccess, clientIp, writeAudit } from '@/lib/audit';
import { reviewGostPackage } from '@/lib/project';
import { parsePackageSnapshot } from '@/lib/gost34/diff';
import { handleApiError } from '@/lib/apiHelpers';

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const params = await props.params;
    const pkg = await prisma.gostPackage.findUnique({
      where: { id: params.id },
    });

    if (!pkg) {
      return NextResponse.json({ error: 'Пакет документов не найден' }, { status: 404 });
    }

    const access = await requireCalcAccess(req, pkg.calculationId, ['review']);
    if (access instanceof NextResponse) return access;

    const body = await req.json();
    const { decision, comment, reviewerName } = body;

    if (decision !== 'approve' && decision !== 'reject') {
      return NextResponse.json(
        { error: 'Параметр decision должен быть approve или reject' },
        { status: 400 },
      );
    }

    if (pkg.status === 'approved') {
      return NextResponse.json(
        { error: 'Утверждённый комплект документов неизменяем' },
        { status: 409 },
      );
    }

    const actorDisplayName =
      reviewerName?.trim() || (access.kind === 'staff' ? access.session?.username : access.actorId);

    const updated = await reviewGostPackage({
      packageId: pkg.id,
      decision,
      actorId: actorDisplayName,
      comment: comment?.trim(),
    });

    await writeAudit({
      actorType: actorTypeFromAccess(access.kind),
      actorId: actorDisplayName,
      action: decision === 'approve' ? 'gost_package.approve' : 'gost_package.reject',
      entityType: 'gost_package',
      entityId: pkg.id,
      meta: {
        version: pkg.version,
        comment: comment?.trim() || null,
        status: updated.status,
      },
      ip: clientIp(req),
    });

    return NextResponse.json({
      package: {
        id: updated.id,
        name: updated.name,
        version: updated.version,
        status: updated.status,
        checksum: updated.checksum,
        approvedAt: updated.approvedAt ? updated.approvedAt.toISOString() : null,
        approvedBy: updated.approvedBy,
        reviewComment: updated.reviewComment,
        snapshot: parsePackageSnapshot(updated),
        updatedAt: updated.updatedAt.toISOString(),
      },
    });
  } catch (err) {
    return handleApiError(err, 'Failed to review package', 500);
  }
}
