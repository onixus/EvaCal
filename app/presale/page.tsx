import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import NewCalculationForm from './NewCalculationForm';
import { getStaffSession, isAnonymousPresaleAllowed } from '@/lib/access';

export const dynamic = 'force-dynamic';

export default async function PresalePage(props: { searchParams: Promise<{ share?: string; templateId?: string }> }) {
  const searchParams = await props.searchParams;
  const staff = await getStaffSession();
  const anonymousOk = isAnonymousPresaleAllowed();

  const allTemplates = await prisma.formTemplate.findMany({
    where: { isActive: true },
    include: { fields: { orderBy: { order: 'asc' } } },
    orderBy: { name: 'asc' },
  });

  // Fallback: if no templates are marked isActive, get the latest available template
  const fallbackTemplates =
    allTemplates.length === 0
      ? await prisma.formTemplate.findMany({
          take: 10,
          include: { fields: { orderBy: { order: 'asc' } } },
          orderBy: { createdAt: 'desc' },
        })
      : [];

  const availableTemplates = allTemplates.length > 0 ? allTemplates : fallbackTemplates;
  const selectedTemplate =
    availableTemplates.find((t) => t.id === searchParams.templateId) ||
    availableTemplates[0] ||
    null;

  // Draft list is staff-only — no cross-tenant leak of other presale work.
  const drafts = staff
    ? await prisma.calculation.findMany({
        where: { createdBy: { in: ['presale', 'presale-share', 'anonymous'] } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { stages: true },
      })
    : [];

  const canCreate = !!staff || anonymousOk || !!searchParams.share;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Интерфейс пресейла</h1>
        <p className="text-sm text-slate-500">
          Заполните опросник — этапы и трудозатраты в человеко-часах рассчитаются автоматически.
        </p>
      </div>

      {!canCreate && (
        <div className="card space-y-2 p-5 text-sm text-slate-600">
          <p>
            Создание расчёта без входа отключено. Нужна share-ссылка с правом{' '}
            <code className="text-xs">create</code> или{' '}
            <Link href="/login" className="text-brand-700 underline">
              вход сотрудника
            </Link>
            .
          </p>
          <p className="text-xs text-slate-400">
            Локально: <code>ALLOW_ANONYMOUS_PRESALE=true</code> (только для демо).
          </p>
        </div>
      )}

      {!selectedTemplate ? (
        <div className="card p-6 text-slate-600">
          Нет активного шаблона опросника. Создайте или импортируйте отраслевые шаблоны в{' '}
          <Link href="/admin" className="text-brand-700 underline">
            интерфейсе администратора
          </Link>
          .
        </div>
      ) : canCreate ? (
        <div className="card p-6">
          <NewCalculationForm
            template={JSON.parse(JSON.stringify(selectedTemplate))}
            availableTemplates={JSON.parse(JSON.stringify(availableTemplates))}
            createShareToken={searchParams.share ?? null}
          />
        </div>
      ) : null}

      {drafts.length > 0 && (
        <div className="card p-5">
          <h2 className="mb-3 font-medium">Недавние расчёты пресейла</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {drafts.map((d) => (
              <li key={d.id} className="flex items-center justify-between py-2">
                <Link href={`/presale/${d.id}`} className="text-brand-700 hover:underline">
                  {d.name} — {d.customer}
                </Link>
                <span className="text-xs text-slate-500">{d.status}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
