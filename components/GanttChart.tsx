'use client';

import { roleLabel } from '@/lib/roles';

export interface GanttStage {
  id: string;
  name: string;
  role: string;
  hours: number;
  isApprovalTask: boolean;
  startDate: string | Date;
  endDate: string | Date;
  status: string;
  requirements?: string | null;
  parallel?: boolean;
}

const ROLE_COLORS: Record<string, { bar: string; ring: string }> = {
  consultant: { bar: 'bg-sky-500', ring: 'ring-sky-200 dark:ring-sky-900' },
  developer: { bar: 'bg-violet-500', ring: 'ring-violet-200 dark:ring-violet-900' },
  engineer: { bar: 'bg-orange-500', ring: 'ring-orange-200 dark:ring-orange-900' },
  analyst: { bar: 'bg-teal-500', ring: 'ring-teal-200 dark:ring-teal-900' },
  architect: { bar: 'bg-indigo-500', ring: 'ring-indigo-200 dark:ring-indigo-900' },
  customer: { bar: 'bg-amber-400', ring: 'ring-amber-200 dark:ring-amber-900' },
  other: { bar: 'bg-slate-400', ring: 'ring-slate-200 dark:ring-slate-700' },
};

function fmtDate(d: string | Date): string {
  return new Date(d).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
  });
}

export default function GanttChart({ stages }: { stages: GanttStage[] }) {
  if (stages.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500 dark:border-nord-3 dark:text-nord-muted">
        Нет этапов для отображения диаграммы Ганта.
      </div>
    );
  }

  const starts = stages.map((s) => new Date(s.startDate).getTime());
  const ends = stages.map((s) => new Date(s.endDate).getTime());
  const rangeStart = Math.min(...starts);
  const rangeEnd = Math.max(...ends, rangeStart + 1000 * 60 * 60 * 24);
  const rangeMs = Math.max(rangeEnd - rangeStart, 1);

  const tick1 = new Date(rangeStart);
  const tick2 = new Date(rangeStart + rangeMs * 0.33);
  const tick3 = new Date(rangeStart + rangeMs * 0.66);
  const tick4 = new Date(rangeEnd);

  return (
    <div className="space-y-3">
      {/* Легенда */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 dark:text-nord-muted">
        <span className="font-semibold text-slate-700 dark:text-nord-4">Роли:</span>
        {Object.entries(ROLE_COLORS).map(([role, cfg]) => (
          <span key={role} className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 dark:bg-nord-1">
            <span className={`h-2 w-2 rounded-full ${cfg.bar}`} />
            <span>{roleLabel(role)}</span>
          </span>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200/80 bg-slate-50/40 p-4 dark:border-nord-3 dark:bg-nord-1/30">
        <div className="min-w-[680px] space-y-2.5">
          {/* Временная шкала */}
          <div className="flex items-center gap-3 border-b border-slate-200/80 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:border-nord-3 dark:text-nord-muted">
            <div className="w-56 shrink-0">Этап / Задача</div>
            <div className="relative flex-1">
              <div className="flex justify-between px-1">
                <span>{fmtDate(tick1)}</span>
                <span>{fmtDate(tick2)}</span>
                <span>{fmtDate(tick3)}</span>
                <span>{fmtDate(tick4)}</span>
              </div>
            </div>
            <div className="w-28 shrink-0 text-right">Сроки</div>
          </div>

          {/* Строки этапов */}
          {stages.map((stage) => {
            const start = new Date(stage.startDate).getTime();
            const end = new Date(stage.endDate).getTime();
            const leftPct = ((start - rangeStart) / rangeMs) * 100;
            const widthPct = Math.max(((end - start) / rangeMs) * 100, 1.2);
            const roleCfg = ROLE_COLORS[stage.role] ?? ROLE_COLORS.other;

            return (
              <div key={stage.id} className="group flex items-center gap-3 py-0.5">
                <div
                  className="w-56 shrink-0 truncate text-xs font-medium text-slate-800 dark:text-nord-4"
                  title={stage.name}
                >
                  {stage.isApprovalTask ? '⏳ ' : ''}
                  {stage.parallel ? '∥ ' : ''}
                  {stage.name}
                </div>

                <div className="relative h-6 flex-1 rounded-md bg-slate-200/50 dark:bg-nord-0/60">
                  <div
                    className={`absolute inset-y-0.5 rounded shadow-xs transition-all ${
                      stage.isApprovalTask
                        ? 'bg-amber-300 border border-dashed border-amber-500 dark:bg-nord-yellow/40 dark:border-nord-yellow'
                        : roleCfg.bar
                    } ${stage.parallel ? 'ring-2 ring-sky-400 dark:ring-nord-frost2' : ''}`}
                    style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                    title={`${stage.name}\n${fmtDate(stage.startDate)} — ${fmtDate(stage.endDate)}${
                      stage.isApprovalTask ? ' (Согласование)' : ` · ${stage.hours} ч`
                    }${stage.requirements ? `\n${stage.requirements}` : ''}`}
                  >
                    {widthPct > 8 && !stage.isApprovalTask && (
                      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white drop-shadow-xs truncate px-1">
                        {stage.hours}ч
                      </span>
                    )}
                  </div>
                </div>

                <div className="w-28 shrink-0 text-right text-xs tabular-nums text-slate-500 dark:text-nord-muted">
                  {fmtDate(stage.startDate)} – {fmtDate(stage.endDate)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
