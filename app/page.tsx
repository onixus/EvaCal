import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { grandTotalHours } from '@/lib/totals';
import StatusBadge from '@/components/StatusBadge';
import Pagination from '@/components/Pagination';
import { PAGE_SIZE, pageArgs, parsePage } from '@/lib/pagination';
import { getStaffSession } from '@/lib/access';

export const dynamic = 'force-dynamic';

export default async function HomePage(props: { searchParams: Promise<{ page?: string }> }) {
  const staff = await getStaffSession();

  if (!staff) {
    return (
      <div className="mx-auto max-w-4xl space-y-8 py-8">
        <div className="card overflow-hidden border-slate-200/80 shadow-md">
          <div className="bg-gradient-to-br from-brand-600 to-indigo-700 p-8 text-white dark:from-nord-0 dark:to-nord-1 dark:border-b dark:border-nord-3">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold backdrop-blur-xs">
              <span>🚀 EvaCal v0.2.0</span>
            </div>
            <h1 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">
              Калькулятор трудозатрат & Комплект ГОСТ 34
            </h1>
            <p className="mt-3 max-w-2xl text-base text-brand-100 dark:text-nord-4">
              Единая корпоративная платформа для оценки трудозатрат ИТ-проектов, календарного планирования и выпуска нормативного комплекта документации (ТЗ, ПЗ, ПМИ, АФ, ЧТЗ).
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/presale" className="btn bg-white text-brand-700 shadow-md hover:bg-brand-50 active:scale-[0.98]">
                📝 Перейти в интерфейс пресейла
              </Link>
              <Link href="/login" className="btn bg-brand-700/80 text-white border border-white/20 hover:bg-brand-800 active:scale-[0.98]">
                🔐 Вход для сотрудников
              </Link>
            </div>
          </div>

          <div className="grid gap-6 p-8 sm:grid-cols-3 bg-white dark:bg-nord-2">
            <div className="space-y-2">
              <div className="text-2xl">⚡</div>
              <h3 className="font-semibold text-slate-900 dark:text-nord-6">
                Быстрая оценка пресейла
              </h3>
              <p className="text-xs text-slate-500 dark:text-nord-muted leading-relaxed">
                Интерактивные опросники с автоматическим расчётом трудозатрат разработчиков, аналитиков и архитекторов.
              </p>
            </div>

            <div className="space-y-2">
              <div className="text-2xl">📊</div>
              <h3 className="font-semibold text-slate-900 dark:text-nord-6">
                План-график и Гант
              </h3>
              <p className="text-xs text-slate-500 dark:text-nord-muted leading-relaxed">
                Учёт параллельных потоков, задач согласования с заказчиком и автоматический расчёт критического пути.
              </p>
            </div>

            <div className="space-y-2">
              <div className="text-2xl">📑</div>
              <h3 className="font-semibold text-slate-900 dark:text-nord-6">
                ГОСТ 34.602-2020 & ИИ
              </h3>
              <p className="text-xs text-slate-500 dark:text-nord-muted leading-relaxed">
                Генерация DOCX с рамкой ГОСТ 2.301, нормализация требований заказчика локальными и облачными LLM.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const page = parsePage((await props.searchParams).page);

  // The archive grows without bound, so read one page at a time — and only the
  // stage/risk fields the totals need, not whole rows (`requirements` can be long).
  const [total, draftCount, approvedCount, calculations] = await Promise.all([
    prisma.calculation.count(),
    prisma.calculation.count({ where: { status: 'draft' } }),
    prisma.calculation.count({ where: { status: 'approved' } }),
    prisma.calculation.findMany({
      ...pageArgs(page),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        template: { select: { name: true } },
        stages: { select: { hours: true, isApprovalTask: true } },
        risks: { select: { hours: true } },
      },
    }),
  ]);

  const pageTotalHours = calculations.reduce(
    (sum, c) => sum + grandTotalHours(c.stages, c.pmHours, c.risks),
    0,
  );

  return (
    <div className="space-y-6">
      {/* Portfolio Stats Bar */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card p-4">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-nord-muted">
            Всего расчётов
          </span>
          <div className="mt-1.5 text-2xl font-bold text-slate-900 dark:text-nord-6">{total}</div>
          <div className="mt-0.5 text-xs text-slate-400 dark:text-nord-muted">В портфеле компании</div>
        </div>

        <div className="card p-4">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-nord-muted">
            В разработке
          </span>
          <div className="mt-1.5 text-2xl font-bold text-amber-600 dark:text-nord-yellow">
            {draftCount}
          </div>
          <div className="mt-0.5 text-xs text-slate-400 dark:text-nord-muted">Черновики и калибровка</div>
        </div>

        <div className="card p-4">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-nord-muted">
            Согласовано
          </span>
          <div className="mt-1.5 text-2xl font-bold text-emerald-600 dark:text-nord-green">
            {approvedCount}
          </div>
          <div className="mt-0.5 text-xs text-slate-400 dark:text-nord-muted">Утверждено заказчиком</div>
        </div>

        <div className="card border-brand-200 bg-brand-50/30 p-4 dark:border-nord-frost4/40 dark:bg-nord-frost4/10">
          <span className="text-[11px] font-bold uppercase tracking-wider text-brand-700 dark:text-nord-frost2">
            Часы на странице
          </span>
          <div className="mt-1.5 text-2xl font-extrabold text-brand-700 dark:text-nord-frost2">
            {pageTotalHours} <span className="text-sm font-semibold">ч</span>
          </div>
          <div className="mt-0.5 text-xs text-brand-600/80 dark:text-nord-frost3">
            ≈ {(pageTotalHours / 8).toFixed(1)} раб. дн.
          </div>
        </div>
      </div>

      {/* Header and Actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-nord-6">Все расчёты</h1>
          <p className="text-xs text-slate-500 dark:text-nord-muted">
            Реестр коммерческих и технических расчётов проектов
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/presale" className="btn-primary">
            <span>+</span>
            <span>Новый расчёт</span>
          </Link>
        </div>
      </div>

      {/* Main Table Card */}
      {total === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-3xl mb-3">📁</div>
          <h3 className="font-semibold text-slate-800 dark:text-nord-5">Пока нет ни одного расчёта</h3>
          <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto dark:text-nord-muted">
            Создайте первый расчёт трудозатрат через интерфейс пресейла.
          </p>
          <div className="mt-4">
            <Link href="/presale" className="btn-primary">
              Создать расчёт
            </Link>
          </div>
        </div>
      ) : calculations.length === 0 ? (
        <div className="card p-8 text-center text-slate-500">На этой странице расчётов нет.</div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200/80 bg-slate-50/70 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:border-nord-3 dark:bg-nord-1/40 dark:text-nord-muted">
                  <th className="py-3.5 px-4">Проект</th>
                  <th className="py-3.5 px-4">Заказчик</th>
                  <th className="py-3.5 px-4">Шаблон</th>
                  <th className="py-3.5 px-4 text-right">Трудозатраты</th>
                  <th className="py-3.5 px-4">Статус</th>
                  <th className="py-3.5 px-4">Дата создания</th>
                  <th className="py-3.5 px-4 text-right">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-nord-3">
                {calculations.map((c) => {
                  const hours = grandTotalHours(c.stages, c.pmHours, c.risks);

                  return (
                    <tr
                      key={c.id}
                      className="group transition-colors hover:bg-slate-50/80 dark:hover:bg-nord-3/30"
                    >
                      <td className="py-3.5 px-4">
                        <Link
                          href={`/calculations/${c.id}`}
                          className="font-semibold text-slate-900 hover:text-brand-600 dark:text-nord-5 dark:hover:text-nord-frost2"
                        >
                          {c.name}
                        </Link>
                      </td>
                      <td className="py-3.5 px-4 text-slate-700 font-medium dark:text-nord-4">
                        {c.customer}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-nord-1 dark:text-nord-4">
                          {c.template.name}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right font-bold tabular-nums text-slate-900 dark:text-nord-6">
                        {hours} <span className="text-xs font-normal text-slate-500">ч</span>
                      </td>
                      <td className="py-3.5 px-4">
                        <StatusBadge status={c.status} />
                      </td>
                      <td className="py-3.5 px-4 text-xs tabular-nums text-slate-500 dark:text-nord-muted">
                        {c.createdAt.toLocaleDateString('ru-RU')}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5 opacity-80 group-hover:opacity-100">
                          <Link
                            href={`/calculations/${c.id}`}
                            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-nord-3 dark:bg-nord-2 dark:text-nord-4 dark:hover:bg-nord-3"
                            title="Открыть карточку проекта"
                          >
                            Хаб
                          </Link>
                          <Link
                            href={`/architect/${c.id}`}
                            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-nord-3 dark:bg-nord-2 dark:text-nord-4 dark:hover:bg-nord-3"
                            title="Открыть в Архитекторе"
                          >
                            🛠️
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

      <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/" />
    </div>
  );
}
