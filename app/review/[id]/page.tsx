import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { resolvePageAccess } from '@/lib/access';
import { parsePackageSnapshot } from '@/lib/gost34/diff';
import PackageReviewClient, { SerializedReviewPackage } from './PackageReviewClient';

export const dynamic = 'force-dynamic';

export default async function PackageReviewPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ share?: string }>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const shareToken = searchParams.share?.trim() || null;

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
    notFound();
  }

  const access = await resolvePageAccess(pkg.calculationId, ['read'], shareToken);

  if (!access) {
    return (
      <main className="min-h-[70vh] flex items-center justify-center p-4">
        <div className="card max-w-md p-8 text-center space-y-4">
          <div className="text-3xl">🔒</div>
          <h1 className="text-lg font-bold text-slate-900 dark:text-nord-6">Доступ ограничен</h1>
          <p className="text-xs text-slate-600 dark:text-nord-4">
            Для просмотра и согласования комплекта ГОСТ 34 требуется действующая ссылка с правом{' '}
            <code className="text-brand-600">review</code> или авторизация сотрудника.
          </p>
        </div>
      </main>
    );
  }

  const snapshot = parsePackageSnapshot(pkg);

  const serializedPackage: SerializedReviewPackage = {
    id: pkg.id,
    name: pkg.name,
    version: pkg.version,
    status: pkg.status,
    calculationId: pkg.calculationId,
    calculationName: pkg.calculation?.name || pkg.name,
    projectName: pkg.project?.name || pkg.calculation?.name || 'Проект',
    customerName: pkg.project?.customer || pkg.calculation?.customer || 'Заказчик',
    projectCode: pkg.project?.code || null,
    standardProfileId: pkg.standardProfileId,
    standardProfileVersion: pkg.standardProfileVersion,
    generatorVersion: pkg.generatorVersion,
    documentTypes: pkg.documentTypes,
    checksum: pkg.checksum,
    hasArtifact: Boolean(pkg.artifactPath),
    releasedAt: pkg.releasedAt ? pkg.releasedAt.toISOString() : null,
    releasedBy: pkg.releasedBy,
    approvedAt: pkg.approvedAt ? pkg.approvedAt.toISOString() : null,
    approvedBy: pkg.approvedBy,
    reviewComment: pkg.reviewComment,
    createdAt: pkg.createdAt.toISOString(),
    snapshot,
  };

  return (
    <PackageReviewClient
      pkg={serializedPackage}
      shareToken={shareToken}
      isStaff={access.kind === 'staff'}
    />
  );
}
