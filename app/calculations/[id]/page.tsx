import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import StatusBadge from '@/components/StatusBadge';
import StageTable from '@/components/StageTable';
import GanttChart from '@/components/GanttChart';
import TotalsSummary from '@/components/TotalsSummary';
import RiskList from '@/components/RiskList';
import ExportLinks from '@/components/ExportLinks';
import { requireRole } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function CalculationViewPage(props: { params: Promise<{ id: string }> }) {
  await requireRole(['architect', 'admin']);
  const params = await props.params;
  const calculation = await prisma.calculation.findUnique({
    where: { id: params.id },
    include: {
      template: { include: { fields: { orderBy: { order: 'asc' } } } },
      stages: { orderBy: { order: 'asc' } },
      risks: { orderBy: { order: 'asc' } },
    },
  });
  if (!calculation) notFound();

  const answers = JSON.parse(calculation.answers) as Record<string, unknown>;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">{calculation.name}</h1>
          <p className="text-sm text-slate-500">
            Заказчик: {calculation.customer} · Шаблон: {calculation.template.name} · Старт проекта:{' '}
            {calculation.startDate.toLocaleDateString('ru-RU')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={calculation.status} />
          <ExportLinks calculationId={calculation.id} />
        </div>
      </div>

      <div className="card p-5">
        <h2 className="mb-3 font-medium">Ответы опросника</h2>
        <dl className="grid gap-3 sm:grid-cols-2">
          {calculation.template.fields.map((field) => (
            <div key={field.id}>
              <dt className="text-xs uppercase tracking-wide text-slate-500">{field.label}</dt>
              <dd className="text-sm">{String(answers[field.key] ?? '—')}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="card p-5">
        <h2 className="mb-3 font-medium">Трудозатраты</h2>
        <TotalsSummary
          stages={calculation.stages}
          pmHours={calculation.pmHours}
          risks={calculation.risks}
        />
      </div>

      <div className="card p-5">
        <h2 className="mb-3 font-medium">Этапы</h2>
        <StageTable stages={calculation.stages} />
      </div>

      <div className="card p-5">
        <h2 className="mb-3 font-medium">Диаграмма Ганта</h2>
        <GanttChart stages={calculation.stages} />
      </div>

      {calculation.risks.length > 0 && (
        <div className="card p-5">
          <h2 className="mb-3 font-medium">Риски</h2>
          <RiskList risks={calculation.risks} />
        </div>
      )}

      <div className="flex gap-3 text-sm">
        <Link href={`/presale/${calculation.id}`} className="btn-secondary">
          Открыть в пресейле
        </Link>
        <Link href={`/architect/${calculation.id}`} className="btn-secondary">
          Открыть у архитектора
        </Link>
      </div>
    </div>
  );
}
