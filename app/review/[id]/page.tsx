import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { resolvePageAccess } from '@/lib/access';
import { hasArchitectPowers, hasReviewerPowers } from '@/lib/appRoles';
import { parsePackageSnapshot } from '@/lib/gost34/diff';
import { parseChecklist, parseComments, type ReviewStage } from '@/lib/gost34/review/types';
import PackageReviewClient, {
  type ReviewQueueItem,
  type SerializedReviewPackage,
} from './PackageReviewClient';

export const dynamic = 'force-dynamic';

/** Дней с выпуска — по ним очередь считает срочность. */
function ageInDays(from: Date): number {
  return Math.max(0, Math.floor((Date.now() - from.getTime()) / 86_400_000));
}

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
        select: { id: true, name: true, customer: true, version: true, status: true },
      },
      project: { select: { id: true, name: true, customer: true, code: true } },
    },
  });

  if (!pkg) notFound();

  const access = await resolvePageAccess(pkg.calculationId, ['read'], shareToken);

  if (!access) {
    return (
      <main className="flex min-h-[70vh] items-center justify-center p-4">
        <div className="card-flat max-w-md space-y-3 p-8 text-center">
          <div className="text-2xl">🔒</div>
          <h1 className="text-base font-bold text-slate-900 dark:text-nord-6">Доступ ограничен</h1>
          <p className="text-xs text-slate-600 dark:text-nord-4">
            Для просмотра и согласования комплекта ГОСТ 34 требуется действующая ссылка с правом{' '}
            <code className="text-brand-700">review</code> или авторизация сотрудника.
          </p>
        </div>
      </main>
    );
  }

  const stage = (
    pkg.reviewStage === 'gap' ? 'gap' : pkg.reviewStage === 'done' ? 'done' : 'tw'
  ) as ReviewStage;

  /**
   * Кто вправе вынести решение на текущем этапе: нормоконтроль ведёт ревьювер,
   * финальное ревью — только ГАП (архитектор или админ). Гость по ссылке с
   * правом review приравнивается к внешнему согласующему и решение выносить
   * может — на этом держится портал согласования с Заказчиком.
   */
  const role = access.kind === 'staff' ? access.session?.role : null;
  const canReview =
    access.kind === 'share'
      ? Boolean(access.share?.scopes.includes('review'))
      : stage === 'gap'
        ? hasArchitectPowers(role)
        : hasReviewerPowers(role);

  // Очередь того же этапа: ревьювер видит, что ещё ждёт нормоконтроля, а ГАП —
  // что ждёт финального решения.
  const queueRows = await prisma.gostPackage.findMany({
    where: { status: 'under_review', reviewStage: stage === 'done' ? 'gap' : stage },
    orderBy: [{ releasedAt: 'asc' }, { createdAt: 'asc' }],
    take: 20,
    include: {
      project: { select: { customer: true } },
      calculation: { select: { customer: true } },
    },
  });

  const queue: ReviewQueueItem[] = queueRows.map((row) => ({
    id: row.id,
    name: row.name,
    version: row.version,
    customerName: row.project?.customer || row.calculation?.customer || 'Заказчик',
    releasedAt: row.releasedAt ? row.releasedAt.toISOString() : null,
    stage: (row.reviewStage === 'gap' ? 'gap' : 'tw') as ReviewStage,
    ageDays: ageInDays(row.releasedAt || row.createdAt),
  }));

  // Открытый комплект всегда присутствует в списке, даже если он уже утверждён
  // и в очередь текущего этапа не попадает.
  if (!queue.some((q) => q.id === pkg.id)) {
    queue.unshift({
      id: pkg.id,
      name: pkg.name,
      version: pkg.version,
      customerName: pkg.project?.customer || pkg.calculation?.customer || 'Заказчик',
      releasedAt: pkg.releasedAt ? pkg.releasedAt.toISOString() : null,
      stage,
      ageDays: ageInDays(pkg.releasedAt || pkg.createdAt),
    });
  }

  const serializedPackage: SerializedReviewPackage = {
    id: pkg.id,
    name: pkg.name,
    version: pkg.version,
    status: pkg.status,
    reviewStage: stage,
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
    snapshot: parsePackageSnapshot(pkg),
    checklist: parseChecklist(pkg.reviewChecklist),
    comments: parseComments(pkg.reviewComments),
    twVersion: pkg.twVersionPath
      ? {
          name: pkg.twVersionName || 'версия тех.писателя.docx',
          uploadedAt: pkg.twVersionUploadedAt ? pkg.twVersionUploadedAt.toISOString() : null,
          uploadedBy: pkg.twVersionUploadedBy,
          isPriority: pkg.twVersionIsPriority,
        }
      : null,
  };

  return (
    <PackageReviewClient
      pkg={serializedPackage}
      queue={queue}
      shareToken={shareToken}
      canReview={canReview}
    />
  );
}
