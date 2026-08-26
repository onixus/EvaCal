import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { resolvePageAccess } from '@/lib/access';
import { listInternalChanges } from '@/lib/changelog';
import InternalChangelogView from '@/components/changelog/InternalChangelogView';

export const dynamic = 'force-dynamic';

export default async function InternalChangelogPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ share?: string }>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const shareToken = searchParams.share?.trim() || null;

  const calculation = await prisma.calculation.findUnique({
    where: { id: params.id },
    select: { id: true, name: true },
  });
  if (!calculation) notFound();

  const access = await resolvePageAccess(params.id, ['read'], shareToken);
  if (!access) {
    return (
      <div className="card-flat mx-auto max-w-md space-y-2 p-8 text-center">
        <h1 className="text-base font-bold text-slate-900 dark:text-nord-6">Доступ ограничен</h1>
        <p className="text-xs text-slate-600 dark:text-nord-4">
          Лист внутренних изменений виден сотрудникам и по share-ссылке с правом чтения.
        </p>
      </div>
    );
  }

  return (
    <InternalChangelogView
      calculationId={calculation.id}
      calculationName={calculation.name}
      changes={await listInternalChanges(params.id)}
      shareToken={shareToken}
    />
  );
}
