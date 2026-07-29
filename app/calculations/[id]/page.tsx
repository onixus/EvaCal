import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { totalLaborHours } from "@/lib/scheduling";
import StatusBadge from "@/components/StatusBadge";
import StageTable from "@/components/StageTable";
import GanttChart from "@/components/GanttChart";

export const dynamic = "force-dynamic";

export default async function CalculationViewPage({ params }: { params: { id: string } }) {
  const calculation = await prisma.calculation.findUnique({
    where: { id: params.id },
    include: {
      template: { include: { fields: { orderBy: { order: "asc" } } } },
      stages: { orderBy: { order: "asc" } },
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
            Заказчик: {calculation.customer} · Шаблон: {calculation.template.name}
          </p>
        </div>
        <StatusBadge status={calculation.status} />
      </div>

      <div className="card p-5">
        <h2 className="mb-3 font-medium">Ответы опросника</h2>
        <dl className="grid gap-3 sm:grid-cols-2">
          {calculation.template.fields.map((field) => (
            <div key={field.id}>
              <dt className="text-xs uppercase tracking-wide text-slate-500">{field.label}</dt>
              <dd className="text-sm">{String(answers[field.key] ?? "—")}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="card p-5">
        <h2 className="mb-3 font-medium">
          Этапы и трудозатраты · Итого {totalLaborHours(calculation.stages)} ч
        </h2>
        <StageTable stages={calculation.stages} />
      </div>

      <div className="card p-5">
        <h2 className="mb-3 font-medium">Диаграмма Ганта</h2>
        <GanttChart stages={calculation.stages} />
      </div>

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
