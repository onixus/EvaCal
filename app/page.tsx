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
      <div className="space-y-6">
        <div className="card space-y-4 p-8">
          <h1 className="text-xl font-semibold">EvaCal</h1>
          <p className="text-sm text-slate-500">
            Калькулятор трудозатрат и комплект ГОСТ 34. Архив расчётов доступен только сотрудникам.
            Пресейл работает по share-ссылке или в режиме локального демо.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/presale" className="btn-primary">
              Интерфейс пресейла
            </Link>
            <Link href="/login" className="btn-secondary">
              Войти
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const page = parsePage((await props.searchParams).page);

  // The archive grows without bound, so read one page at a time — and only the
  // stage/risk fields the totals need, not whole rows (`requirements` can be long).
  const [total, calculations] = await Promise.all([
    prisma.calculation.count(),
    prisma.calculation.findMany({
      ...pageArgs(page),
      orderBy: { createdAt: 'desc' },
      include: {
        template: { select: { name: true } },
        stages: { select: { hours: true, isApprovalTask: true } },
        risks: { select: { hours: true } },
      },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Все расчёты</h1>
          <p className="text-sm text-slate-500">
            Архив для сотрудников (архитектор / администратор).
          </p>
        </div>
        <Link href="/presale" className="btn-primary">
          + Новый расчёт
        </Link>
      </div>

      {total === 0 ? (
        <div className="card p-8 text-center text-slate-500">
          Пока нет ни одного расчёта. Начните с интерфейса пресейла.
        </div>
      ) : calculations.length === 0 ? (
        <div className="card p-8 text-center text-slate-500">
          На этой странице расчётов нет.{' '}
          <Link href="/" className="text-brand-700 hover:underline">
            К первой странице
          </Link>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="p-3">Название</th>
                <th className="p-3">Заказчик</th>
                <th className="p-3">Шаблон</th>
                <th className="p-3">Трудозатраты, ч</th>
                <th className="p-3">Статус</th>
                <th className="p-3">Создан</th>
              </tr>
            </thead>
            <tbody>
              {calculations.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-slate-100 last:border-0 hover:bg-slate-50"
                >
                  <td className="p-3">
                    <Link
                      href={`/calculations/${c.id}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {c.name}
                    </Link>
                  </td>
                  <td className="p-3">{c.customer}</td>
                  <td className="p-3 text-slate-600">{c.template.name}</td>
                  <td className="p-3">{grandTotalHours(c.stages, c.pmHours, c.risks)}</td>
                  <td className="p-3">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="p-3 text-slate-500">{c.createdAt.toLocaleDateString('ru-RU')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/" />
    </div>
  );
}
