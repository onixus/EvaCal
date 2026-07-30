import { totalLaborHours } from "@/lib/scheduling";
import { risksTotalHours } from "@/lib/totals";

export interface RiskRow {
  id: string;
  description: string;
  hours: number;
}

interface Props {
  stages: { hours: number; isApprovalTask: boolean }[];
  pmHours: number;
  risks: RiskRow[];
}

export default function TotalsSummary({ stages, pmHours, risks }: Props) {
  const stagesHours = totalLaborHours(stages);
  const risksHours = risksTotalHours(risks);
  const grandTotal = stagesHours + pmHours + risksHours;

  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
      <div>
        <dt className="text-xs uppercase tracking-wide text-slate-500 dark:text-nord-muted">Этапы</dt>
        <dd>{stagesHours} ч</dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-slate-500 dark:text-nord-muted">РП</dt>
        <dd>{pmHours} ч</dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-slate-500 dark:text-nord-muted">Риски</dt>
        <dd>{risksHours} ч</dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-slate-500 dark:text-nord-muted">Итого</dt>
        <dd className="font-semibold">{grandTotal} ч</dd>
      </div>
    </dl>
  );
}
