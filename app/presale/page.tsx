import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import NewCalculationForm from './NewCalculationForm';
import { getInternalSession, isAnonymousPresaleAllowed, verifyShareToken } from '@/lib/access';

export const dynamic = 'force-dynamic';

export default async function PresalePage(props: {
  searchParams: Promise<{ share?: string; templateId?: string; projectId?: string }>;
}) {
  const searchParams = await props.searchParams;
  const staff = await getInternalSession();
  const anonymousOk = isAnonymousPresaleAllowed();

  const linkedProject = searchParams.projectId
    ? await prisma.project.findUnique({
        where: { id: searchParams.projectId },
        select: { id: true, name: true, customer: true },
      })
    : null;

  const templateInclude = { fields: { orderBy: { order: 'asc' as const } } };

  // Share-токен, выданный на конкретный шаблон, API всё равно не пустит
  // в другой (см. POST /api/calculations) — поэтому и выбирать тут нечего.
  const shareTemplateId = verifyShareToken(searchParams.share)?.templateId ?? null;
  const shareTemplate = shareTemplateId
    ? await prisma.formTemplate.findUnique({
        where: { id: shareTemplateId },
        include: templateInclude,
      })
    : null;

  // Все активные шаблоны — это продукты/отрасли, из которых пресейл выбирает
  // опросник. Без активных — последние шаблоны, чтобы пустая настройка не
  // блокировала работу.
  const activeTemplates = shareTemplate
    ? []
    : await prisma.formTemplate.findMany({
        where: { isActive: true },
        include: templateInclude,
        orderBy: { name: 'asc' },
      });
  const fallbackTemplates =
    !shareTemplate && activeTemplates.length === 0
      ? await prisma.formTemplate.findMany({
          take: 10,
          include: templateInclude,
          orderBy: { createdAt: 'desc' },
        })
      : [];

  const availableTemplates = shareTemplate
    ? [shareTemplate]
    : activeTemplates.length > 0
      ? activeTemplates
      : fallbackTemplates;
  // Предвыбор только явный (?templateId=, привязка share) — первого попавшегося
  // шаблона по умолчанию нет, иначе расчёт молча заводится не по тому продукту.
  const initialTemplateId =
    availableTemplates.find((t) => t.id === (shareTemplateId ?? searchParams.templateId))?.id ??
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
    <div className="page">
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

      {availableTemplates.length === 0 ? (
        <div className="card p-6 text-slate-600">
          Нет активного шаблона опросника. Создайте или импортируйте отраслевые шаблоны в{' '}
          <Link href="/admin" className="text-brand-700 underline">
            интерфейсе администратора
          </Link>
          .
        </div>
      ) : canCreate ? (
        <NewCalculationForm
          availableTemplates={JSON.parse(JSON.stringify(availableTemplates))}
          initialTemplateId={initialTemplateId}
          createShareToken={searchParams.share ?? null}
          initialProjectId={linkedProject?.id ?? null}
          initialProjectName={linkedProject?.name ?? ''}
          initialCustomer={linkedProject?.customer ?? ''}
        />
      ) : null}

      {drafts.length > 0 && (
        <div className="card">
          <div className="card-head">
            <span className="card-title">Недавние расчёты пресейла</span>
          </div>
          <ul className="divide-y divide-slate-100 px-4 text-sm dark:divide-nord-3">
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
