import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/auth';
import { hasArchitectPowers } from '@/lib/appRoles';
import { REVIEW_STAGE_LABELS, type ReviewStage } from '@/lib/gost34/review/types';

export const dynamic = 'force-dynamic';

function ageInDays(from: Date): number {
  return Math.max(0, Math.floor((Date.now() - from.getTime()) / 86_400_000));
}

/**
 * Очередь ревью. Ревьювер видит комплекты на нормоконтроле, ГАП — те, что
 * прошли первый этап и ждут финального решения.
 */
export default async function ReviewQueuePage() {
  const session = await requireRole(['reviewer', 'architect', 'admin'], '/review');
  const stage: ReviewStage = hasArchitectPowers(session.role) ? 'gap' : 'tw';

  const packages = await prisma.gostPackage.findMany({
    where: { status: 'under_review', reviewStage: stage },
    orderBy: [{ releasedAt: 'asc' }, { createdAt: 'asc' }],
    take: 50,
    include: {
      project: { select: { customer: true } },
      calculation: { select: { customer: true } },
    },
  });

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-nord-6">
          {stage === 'gap' ? 'Финальное ревью — ГАП' : 'Очередь ревью документации'}
        </h1>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-nord-muted">
          {stage === 'gap'
            ? 'Комплекты, прошедшие нормоконтроль тех.писателя и ожидающие решения о выпуске.'
            : 'Комплекты на нормоконтроле: чек-лист оформления, комментарии по разделам и версия тех.писателя.'}
        </p>
      </div>

      {packages.length === 0 ? (
        <div className="card-flat p-8 text-center text-xs text-slate-500 dark:text-nord-muted">
          На этом этапе комплектов нет.
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {packages.map((pkg) => {
            const age = ageInDays(pkg.releasedAt || pkg.createdAt);
            const chip = age >= 5 ? 'chip-block' : age >= 2 ? 'chip-warn' : 'chip-muted';
            return (
              <Link
                key={pkg.id}
                href={`/review/${pkg.id}`}
                className="card-flat space-y-1.5 p-3.5 transition-colors hover:border-slate-300 dark:hover:border-nord-4/30"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 truncate text-xs font-bold text-slate-900 dark:text-nord-6">
                    {pkg.name}
                  </span>
                  <span className={chip}>{age >= 5 ? 'срочно' : `${age} дн.`}</span>
                </div>
                <div className="text-[10px] text-slate-400 dark:text-nord-muted">
                  {pkg.project?.customer || pkg.calculation?.customer || 'Заказчик'} · v
                  {pkg.version} · {REVIEW_STAGE_LABELS[stage]}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
