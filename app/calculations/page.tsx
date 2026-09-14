import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { grandTotalHours } from '@/lib/totals';
import StatusBadge from '@/components/StatusBadge';
import Pagination from '@/components/Pagination';
import PageHeader from '@/components/PageHeader';
import FilterChips from '@/components/filters/FilterChips';
import SearchField from '@/components/filters/SearchField';
import { PAGE_SIZE, pageArgs, parsePage } from '@/lib/pagination';
import { containsInsensitive } from '@/lib/textSearch';
import { requireRole } from '@/lib/auth';
import { canCreateCalculation } from '@/lib/appRoles';

export const dynamic = 'force-dynamic';

const STATUS_FILTERS = [
  { value: 'all', label: 'Все' },
  { value: 'draft', label: 'Черновики' },
  { value: 'pending_approval', label: 'На согласовании' },
  { value: 'approved', label: 'Утверждённые' },
];

/**
 * Архив расчётов: все версии всех проектов. Для работы по проекту есть
 * карточка проекта; этот экран — поиск конкретной сметы.
 */
export default async function CalculationsPage(props: {
  searchParams: Promise<{ page?: string; status?: string; search?: string }>;
}) {
  const session = await requireRole(['presale', 'architect', 'gap', 'admin'], '/calculations');
  const sp = await props.searchParams;
  const page = parsePage(sp.page);
  const status = STATUS_FILTERS.some((f) => f.value === sp.status) ? sp.status! : 'all';
  const search = sp.search?.trim() || '';

  const where: Record<string, unknown> = {};
  if (status !== 'all') where.status = status;
  if (search) {
    where.OR = [
      { name: containsInsensitive(search) },
      { customer: containsInsensitive(search) },
      { project: { is: { code: containsInsensitive(search) } } },
    ];
  }

  // The archive grows without bound, so read one page at a time — and only the
  // stage/risk fields the totals need, not whole rows (`requirements` can be long).
  const [total, counts, calculations] = await Promise.all([
    prisma.calculation.count({ where }),
    prisma.calculation.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.calculation.findMany({
      where,
      ...pageArgs(page),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        template: { select: { name: true } },
        project: { select: { id: true, name: true, code: true } },
        stages: { select: { hours: true, isApprovalTask: true } },
        risks: { select: { hours: true } },
      },
    }),
  ]);

  const countOf = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0;
  const allCount = counts.reduce((sum, c) => sum + c._count._all, 0);
  const filters = STATUS_FILTERS.map((f) => ({
    ...f,
    count: f.value === 'all' ? allCount : countOf(f.value),
  }));

  const query = new URLSearchParams();
  if (status !== 'all') query.set('status', status);
  if (search) query.set('search', search);
  const basePath = query.toString() ? `/calculations?${query}` : '/calculations';

  return (
    <div className="page">
      <PageHeader
        title="Расчёты и сметы"
        description="Все версии расчётов по всем проектам. Чтобы вести проект по этапам, откройте его карточку."
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <FilterChips param="status" options={filters} value={status} defaultValue="all" />
          <SearchField placeholder="Название, заказчик, шифр проекта…" className="w-full sm:w-72" />
        </div>
      </PageHeader>

      {calculations.length === 0 ? (
        <div className="card p-10 text-center">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-nord-5">
            {allCount === 0 ? 'Пока нет ни одного расчёта' : 'По этому фильтру расчётов нет'}
          </h3>
          <p className="mx-auto mt-1 max-w-sm text-xs text-slate-500 dark:text-nord-muted">
            {allCount === 0
              ? 'Создайте первый расчёт трудозатрат через пресейл-мастер.'
              : 'Снимите фильтр по статусу или измените поисковый запрос.'}
          </p>
          {allCount === 0 && canCreateCalculation(session.role) && (
            <Link href="/presale" className="btn-primary mt-4">
              Создать расчёт
            </Link>
          )}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-list min-w-[880px]">
              <thead>
                <tr>
                  <th>Расчёт</th>
                  <th>Проект</th>
                  <th>Шаблон</th>
                  <th className="text-right">Трудозатраты</th>
                  <th>Статус</th>
                  <th>Создан</th>
                  <th className="text-right">Открыть</th>
                </tr>
              </thead>
              <tbody>
                {calculations.map((c) => {
                  const hours = grandTotalHours(c.stages, c.pmHours, c.risks);
                  return (
                    <tr key={c.id}>
                      <td>
                        <Link
                          href={`/calculations/${c.id}`}
                          className="font-semibold text-slate-900 hover:text-brand-600 dark:text-nord-5 dark:hover:text-nord-frost2"
                        >
                          {c.name}
                        </Link>
                        <div className="text-[11px] text-slate-500 dark:text-nord-muted">
                          v{c.version} · {c.customer}
                        </div>
                      </td>
                      <td>
                        {c.project ? (
                          <Link
                            href={`/projects/${c.project.id}`}
                            className="text-brand-700 hover:underline dark:text-nord-frost2"
                          >
                            {c.project.code ? (
                              <span className="font-mono text-[11px] font-bold">
                                {c.project.code}
                              </span>
                            ) : (
                              c.project.name
                            )}
                          </Link>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td>
                        <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-nord-1 dark:text-nord-4">
                          {c.template.name}
                        </span>
                      </td>
                      <td className="nums whitespace-nowrap text-right font-bold text-slate-900 dark:text-nord-6">
                        {hours} <span className="text-xs font-normal text-slate-500">ч</span>
                      </td>
                      <td>
                        <StatusBadge status={c.status} />
                      </td>
                      <td className="nums whitespace-nowrap text-xs text-slate-500 dark:text-nord-muted">
                        {c.createdAt.toLocaleDateString('ru-RU')}
                      </td>
                      <td className="text-right">
                        <div className="inline-flex items-center gap-1">
                          <Link href={`/calculations/${c.id}`} className="btn-secondary btn-sm">
                            Хаб
                          </Link>
                          <Link
                            href={`/architect/${c.id}`}
                            className="btn-ghost btn-sm"
                            title="Этапы, Гант и утверждение сметы"
                          >
                            Архитектор
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath={basePath} />
    </div>
  );
}
