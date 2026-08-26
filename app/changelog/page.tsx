import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/auth';
import { formatChangeNumber } from '@/lib/changelogTypes';

export const dynamic = 'force-dynamic';

/**
 * Лист изменений ведётся по расчёту, поэтому общий пункт навигации показывает,
 * у каких расчётов он не пуст, и ведёт в конкретный лист.
 */
export default async function ChangelogIndexPage() {
  await requireRole(['reviewer', 'architect', 'admin'], '/changelog');

  const grouped = await prisma.internalChange.groupBy({
    by: ['calculationId'],
    _count: { _all: true },
    _max: { seq: true, occurredAt: true },
    orderBy: { _max: { occurredAt: 'desc' } },
    take: 30,
  });

  const calculations = await prisma.calculation.findMany({
    where: { id: { in: grouped.map((g) => g.calculationId) } },
    select: { id: true, name: true, customer: true },
  });
  const byId = new Map(calculations.map((c) => [c.id, c]));

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-nord-6">
          Лист внутренних изменений
        </h1>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-nord-muted">
          Журнал правок комплектов и расчётов: inline-правки студии, версии тех.писателя и решения
          ревью.
        </p>
      </div>

      {grouped.length === 0 ? (
        <div className="card-flat p-8 text-center text-xs text-slate-500 dark:text-nord-muted">
          Изменений пока нет ни по одному расчёту.
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {grouped.map((row) => {
            const calc = byId.get(row.calculationId);
            if (!calc) return null;
            return (
              <Link
                key={row.calculationId}
                href={`/calculations/${row.calculationId}/changelog`}
                className="card-flat space-y-1 p-3.5 transition-colors hover:border-slate-300 dark:hover:border-nord-4/30"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 truncate text-xs font-bold text-slate-900 dark:text-nord-6">
                    {calc.name}
                  </span>
                  <span className="chip-muted nums">
                    {row._max.seq ? formatChangeNumber(row._max.seq) : '—'}
                  </span>
                </div>
                <div className="text-[10px] text-slate-400 dark:text-nord-muted">
                  {calc.customer} · записей: {row._count._all}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
