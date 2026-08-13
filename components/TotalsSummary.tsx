import { totalLaborHours } from '@/lib/scheduling';
import { risksTotalHours } from '@/lib/totals';

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

  const stagesPct = grandTotal > 0 ? Math.round((stagesHours / grandTotal) * 100) : 0;
  const pmPct = grandTotal > 0 ? Math.round((pmHours / grandTotal) * 100) : 0;
  const risksPct = grandTotal > 0 ? Math.round((risksHours / grandTotal) * 100) : 0;
  const grandTotalDays = (grandTotal / 8).toFixed(1);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {/* 1. Этапы разработки */}
      <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3.5 transition-all dark:border-nord-3 dark:bg-nord-1/40">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-nord-muted">
            Разработка
          </span>
          <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 dark:bg-nord-frost4/30 dark:text-nord-frost2">
            {stagesPct}%
          </span>
        </div>
        <div className="mt-2 flex items-baseline gap-1.5">
          <span className="text-2xl font-bold text-slate-900 dark:text-nord-6">{stagesHours}</span>
          <span className="text-xs font-medium text-slate-500 dark:text-nord-muted">ч</span>
        </div>
        <div className="mt-1 text-[11px] text-slate-400 dark:text-nord-muted">
          ≈ {(stagesHours / 8).toFixed(1)} раб. дн.
        </div>
      </div>

      {/* 2. Управление проектом */}
      <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3.5 transition-all dark:border-nord-3 dark:bg-nord-1/40">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-nord-muted">
            РП / PM
          </span>
          <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-nord-purple/20 dark:text-nord-purple">
            {pmPct}%
          </span>
        </div>
        <div className="mt-2 flex items-baseline gap-1.5">
          <span className="text-2xl font-bold text-slate-900 dark:text-nord-6">{pmHours}</span>
          <span className="text-xs font-medium text-slate-500 dark:text-nord-muted">ч</span>
        </div>
        <div className="mt-1 text-[11px] text-slate-400 dark:text-nord-muted">
          Координация и контроль
        </div>
      </div>

      {/* 3. Буфер рисков */}
      <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3.5 transition-all dark:border-nord-3 dark:bg-nord-1/40">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-nord-muted">
            Буфер рисков
          </span>
          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-nord-yellow/20 dark:text-nord-yellow">
            {risksPct}%
          </span>
        </div>
        <div className="mt-2 flex items-baseline gap-1.5">
          <span className="text-2xl font-bold text-slate-900 dark:text-nord-6">{risksHours}</span>
          <span className="text-xs font-medium text-slate-500 dark:text-nord-muted">ч</span>
        </div>
        <div className="mt-1 text-[11px] text-slate-400 dark:text-nord-muted">
          {risks.length > 0 ? `${risks.length} позиц.` : 'Без рисков'}
        </div>
      </div>

      {/* 4. ИТОГО */}
      <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-3.5 shadow-xs transition-all dark:border-nord-frost4/50 dark:bg-nord-frost4/10">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider text-brand-700 dark:text-nord-frost2">
            Итого проект
          </span>
          <span className="rounded-full bg-brand-600 px-1.5 py-0.5 text-[10px] font-bold text-white dark:bg-nord-frost4">
            100%
          </span>
        </div>
        <div className="mt-2 flex items-baseline gap-1.5">
          <span className="text-2xl font-extrabold text-brand-700 dark:text-nord-frost2">
            {grandTotal}
          </span>
          <span className="text-xs font-bold text-brand-700 dark:text-nord-frost2">ч</span>
        </div>
        <div className="mt-1 text-[11px] font-semibold text-brand-600/80 dark:text-nord-frost3">
          ≈ {grandTotalDays} рабочих дней
        </div>
      </div>
    </div>
  );
}
