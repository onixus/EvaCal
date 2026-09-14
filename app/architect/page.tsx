import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import StatusBadge from '@/components/StatusBadge';
import { grandTotalHours } from '@/lib/totals';
import Pagination from '@/components/Pagination';
import { PAGE_SIZE, pageArgs, parsePage } from '@/lib/pagination';
import { loadCapacityMatrix } from '@/lib/capacityData';
import { worstRoles } from '@/lib/capacity';
import { roleLabel } from '@/lib/roles';

export const dynamic = 'force-dynamic';

const PENDING = 'pending_approval';

// Only the fields the totals and the table actually render.
const listSelection = {
  stages: { select: { hours: true, isApprovalTask: true } },
  risks: { select: { hours: true } },
  template: { select: { name: true } },
} as const;

type ListedCalculation = {
  id: string;
  name: string;
  customer: string;
  status: string;
  pmHours: number;
  template: { name: string };
  stages: { hours: number; isApprovalTask: boolean }[];
  risks: { hours: number }[];
};

export default async function ArchitectPage(props: { searchParams: Promise<{ page?: string }> }) {
  const page = parsePage((await props.searchParams).page);

  // The approval queue is the architect's actual work list, so it is shown in full;
  // only the archive below it is paged.
  const [pending, othersTotal, others, capacity] = await Promise.all([
    prisma.calculation.findMany({
      where: { status: PENDING },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: listSelection,
    }),
    prisma.calculation.count({ where: { status: { not: PENDING } } }),
    prisma.calculation.findMany({
      where: { status: { not: PENDING } },
      ...pageArgs(page),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: listSelection,
    }),
    // Виджет ресурсного плана: 4 ближайшие недели, худшие роли. Падение
    // виджета не должно ронять рабочий экран.
    loadCapacityMatrix({ weeks: 4 }).catch(() => null),
  ]);
  const worst = capacity ? worstRoles(capacity) : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Интерфейс архитектора</h1>
        <p className="text-sm text-slate-500">
          Правьте этапы, добавляйте новые и утверждайте расчёты, подготовленные пресейлом.
        </p>
      </div>

      {worst.length > 0 && (
        <div
          className="card flex flex-wrap items-center gap-3 p-4 text-xs"
          data-testid="capacity-widget"
        >
          <span className="font-semibold text-slate-700 dark:text-nord-4">
            Загрузка на 4 недели:
          </span>
          {worst.map((w) => (
            <span
              key={w.role}
              className={`rounded-full px-2.5 py-0.5 font-semibold ${
                w.maxUtil > 1
                  ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200'
                  : w.maxUtil > 0.85
                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-100'
                    : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-100'
              }`}
            >
              {roleLabel(w.role)} {Math.round(w.maxUtil * 100)}%
            </span>
          ))}
          <Link href="/capacity" className="underline">
            ресурсный план →
          </Link>
        </div>
      )}

      <Section
        title="Ожидают согласования"
        items={pending}
        empty="Нет расчётов, ожидающих согласования."
      />
      <Section title="Остальные расчёты" items={others} empty="Пока нет других расчётов.">
        <Pagination page={page} pageSize={PAGE_SIZE} total={othersTotal} basePath="/architect" />
      </Section>
    </div>
  );

  function Section({
    title,
    items,
    empty,
    children,
  }: {
    title: string;
    items: ListedCalculation[];
    empty: string;
    children?: React.ReactNode;
  }) {
    return (
      <div className="card p-5">
        <h2 className="mb-3 font-medium">{title}</h2>
        {items.length === 0 ? (
          <p className="text-sm text-slate-500">{empty}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-4">Название</th>
                <th className="py-2 pr-4">Заказчик</th>
                <th className="py-2 pr-4">Шаблон</th>
                <th className="py-2 pr-4">Трудозатраты, ч</th>
                <th className="py-2 pr-4">Статус</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-slate-100 last:border-0 hover:bg-slate-50"
                >
                  <td className="py-2 pr-4">
                    <Link
                      href={`/architect/${c.id}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {c.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{c.customer}</td>
                  <td className="py-2 pr-4 text-slate-600">{c.template.name}</td>
                  <td className="py-2 pr-4">{grandTotalHours(c.stages, c.pmHours, c.risks)}</td>
                  <td className="py-2 pr-4">
                    <StatusBadge status={c.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {children}
      </div>
    );
  }
}
