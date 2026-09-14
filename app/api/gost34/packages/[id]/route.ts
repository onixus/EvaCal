import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireCalcAccess } from '@/lib/access';
import { parsePackageSnapshot } from '@/lib/gost34/diff';
import { parseChecklist, parseComments } from '@/lib/gost34/review/types';
import { handleApiError } from '@/lib/apiHelpers';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const params = await props.params;
    const pkg = await prisma.gostPackage.findUnique({
      where: { id: params.id },
      include: {
        calculation: {
          select: {
            id: true,
            name: true,
            customer: true,
            version: true,
            status: true,
          },
        },
        project: {
          select: {
            id: true,
            name: true,
            customer: true,
            code: true,
          },
        },
      },
    });

    if (!pkg) {
      return NextResponse.json({ error: 'Пакет документов не найден' }, { status: 404 });
    }

    // Access check: by calculation access (staff, share token read/review/export, or anonymous presale)
    const access = await requireCalcAccess(req, pkg.calculationId, ['read']);
    if (access instanceof NextResponse) return access;

    return NextResponse.json({
      package: {
        id: pkg.id,
        name: pkg.name,
        version: pkg.version,
        status: pkg.status,
        projectId: pkg.projectId,
        project: pkg.project,
        calculationId: pkg.calculationId,
        calculation: pkg.calculation,
        standardProfileId: pkg.standardProfileId,
        standardProfileVersion: pkg.standardProfileVersion,
        generatorVersion: pkg.generatorVersion,
        documentTypes: pkg.documentTypes,
        checksum: pkg.checksum,
        hasArtifact: Boolean(pkg.artifactPath),
        // Состояние ревью отдаётся на чтении, а не только в ответе на решение:
        // без него потребитель API не знает, на чьей подписи стоит комплект.
        reviewStage: pkg.reviewStage,
        reviewChecklist: parseChecklist(pkg.reviewChecklist),
        reviewComments: parseComments(pkg.reviewComments),
        twVersion: pkg.twVersionPath
          ? {
              name: pkg.twVersionName,
              uploadedAt: pkg.twVersionUploadedAt ? pkg.twVersionUploadedAt.toISOString() : null,
              uploadedBy: pkg.twVersionUploadedBy,
              isPriority: pkg.twVersionIsPriority,
            }
          : null,
        snapshot: parsePackageSnapshot(pkg),
        releasedAt: pkg.releasedAt ? pkg.releasedAt.toISOString() : null,
        releasedBy: pkg.releasedBy,
        approvedAt: pkg.approvedAt ? pkg.approvedAt.toISOString() : null,
        approvedBy: pkg.approvedBy,
        reviewComment: pkg.reviewComment,
        createdAt: pkg.createdAt.toISOString(),
        updatedAt: pkg.updatedAt.toISOString(),
      },
    });
  } catch (err) {
    return handleApiError(err, 'Failed to fetch package', 500);
  }
}
