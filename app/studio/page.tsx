import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Студия открывается для конкретного расчёта, поэтому пункт навигации ведёт
 * на выбор расчёта, а не на пустой экран студии без контекста.
 */
export default async function StudioPickerPage() {
  await requireRole(['architect', 'admin'], '/studio');

  const calculations = await prisma.calculation.findMany({
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: 30,
    select: {
      id: true,
      name: true,
      customer: true,
      version: true,
      updatedAt: true,
      standardProfileId: true,
    },
  });

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-nord-6">
          Студия ГОСТ 34
        </h1>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-nord-muted">
          Выберите расчёт — студия откроет его требования, применимость, трассируемость и выпуск.
        </p>
      </div>

      {calculations.length === 0 ? (
        <div className="card-flat p-8 text-center text-xs text-slate-500 dark:text-nord-muted">
          Расчётов пока нет. Создайте первый в пресейл-мастере.
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {calculations.map((calc) => (
            <Link
              key={calc.id}
              href={`/calculations/${calc.id}/studio`}
              className="card-flat space-y-1 p-3.5 transition-colors hover:border-slate-300 dark:hover:border-nord-4/30"
            >
              <div className="truncate text-xs font-bold text-slate-900 dark:text-nord-6">
                {calc.name}
              </div>
              <div className="text-[10px] text-slate-400 dark:text-nord-muted">
                {calc.customer} · v{calc.version} ·{' '}
                {calc.standardProfileId ? 'профиль закреплён' : 'профиль не выбран'}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
