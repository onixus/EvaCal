import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import StatusBadge from '@/components/StatusBadge';
import { grandTotalHours } from '@/lib/totals';
import Pagination from '@/components/Pagination';
import { PAGE_SIZE, pageArgs, parsePage } from '@/lib/pagination';

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
  const [pending, othersTotal, others] = await Promise.all([
    prisma.calculation.findMany({
      where: { status: PENDING },
      orderBy: { createdAt: 'desc' },
      include: listSelection,
    }),
    prisma.calculation.count({ where: { status: { not: PENDING } } }),
    prisma.calculation.findMany({
      where: { status: { not: PENDING } },
      ...pageArgs(page),
      orderBy: { createdAt: 'desc' },
      include: listSelection,
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Интерфейс архитектора</h1>
        <p className="text-sm text-slate-500">
          Правьте этапы, добавляйте новые и утверждайте расчёты, подготовленные пресейлом.
        </p>
      </div>

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
