'use client';

import { roleLabel } from '@/lib/roles';
import StatusBadge from './StatusBadge';

export interface StageRow {
  id: string;
  name: string;
  role: string;
  hours: number;
  isApprovalTask: boolean;
  startDate: string | Date;
  endDate: string | Date;
  dueDate: string | Date | null;
  status: string;
  requirements?: string | null;
  parallel?: boolean;
  approvalDays?: number | null;
}

const ROLE_BADGES: Record<string, string> = {
  consultant:
    'bg-sky-50 text-sky-700 border border-sky-200/70 dark:bg-nord-frost3/15 dark:text-nord-frost3 dark:border-nord-frost3/30',
  developer:
    'bg-violet-50 text-violet-700 border border-violet-200/70 dark:bg-nord-purple/15 dark:text-nord-purple dark:border-nord-purple/30',
  engineer:
    'bg-orange-50 text-orange-700 border border-orange-200/70 dark:bg-nord-orange/15 dark:text-nord-orange dark:border-nord-orange/30',
  analyst:
    'bg-teal-50 text-teal-700 border border-teal-200/70 dark:bg-nord-frost1/15 dark:text-nord-frost1 dark:border-nord-frost1/30',
  architect:
    'bg-indigo-50 text-indigo-700 border border-indigo-200/70 dark:bg-nord-frost4/15 dark:text-nord-frost2 dark:border-nord-frost4/30',
  customer:
    'bg-amber-50 text-amber-800 border border-amber-200/70 dark:bg-nord-yellow/15 dark:text-nord-yellow dark:border-nord-yellow/30',
  other: 'bg-slate-100 text-slate-700 border border-slate-200 dark:bg-nord-3 dark:text-nord-4',
};

function fmt(d: string | Date): string {
  return new Date(d).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export default function StageTable({ stages }: { stages: StageRow[] }) {
  const totalHours = stages.filter((s) => !s.isApprovalTask).reduce((sum, s) => sum + s.hours, 0);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200/80 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:border-nord-3 dark:text-nord-muted">
            <th className="py-3 pr-4">Этап</th>
            <th className="py-3 pr-4">Исполнитель / Роль</th>
            <th className="py-3 pr-4 text-right">Часы</th>
            <th className="py-3 pr-4">Начало</th>
            <th className="py-3 pr-4">Окончание</th>
            <th className="py-3 pr-4">Срок согласования</th>
            <th className="py-3 pr-4">Статус</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-nord-3">
          {stages.map((stage) => {
            const roleClass =
              ROLE_BADGES[stage.role] ??
              'bg-slate-100 text-slate-700 border border-slate-200 dark:bg-nord-3 dark:text-nord-4';

            return (
              <tr
                key={stage.id}
                className={`transition-colors hover:bg-slate-50/70 dark:hover:bg-nord-3/40 ${
                  stage.isApprovalTask ? 'bg-amber-50/30 dark:bg-nord-yellow/5' : ''
                }`}
              >
                <td className="py-3 pr-4">
                  <div className="flex items-start gap-2">
                    {stage.isApprovalTask && (
                      <span className="mt-0.5 text-xs" title="Задача согласования">
                        ⏳
                      </span>
                    )}
                    {stage.parallel && (
                      <span
                        className="mt-0.5 rounded bg-sky-100 px-1 py-0.2 text-[10px] font-bold text-sky-700 dark:bg-nord-frost4/30 dark:text-nord-frost2"
                        title="Выполняется параллельно"
                      >
                        ∥
                      </span>
                    )}
                    <div>
                      <div className="font-medium text-slate-900 dark:text-nord-5">
                        {stage.name}
                      </div>
                      {stage.requirements && (
                        <div className="mt-0.5 text-xs text-slate-500 line-clamp-2 dark:text-nord-muted">
                          {stage.requirements}
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="py-3 pr-4">
                  <span
                    className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${roleClass}`}
                  >
                    {roleLabel(stage.role)}
                  </span>
                </td>
                <td className="py-3 pr-4 text-right font-semibold tabular-nums text-slate-800 dark:text-nord-5">
                  {stage.isApprovalTask ? (
                    <span className="text-slate-400 font-normal">—</span>
                  ) : (
                    `${stage.hours} ч`
                  )}
                </td>
                <td className="py-3 pr-4 text-xs tabular-nums text-slate-600 dark:text-nord-4">
                  {fmt(stage.startDate)}
                </td>
                <td className="py-3 pr-4 text-xs tabular-nums text-slate-600 dark:text-nord-4">
                  {fmt(stage.endDate)}
                </td>
                <td className="py-3 pr-4 text-xs tabular-nums text-slate-500 dark:text-nord-muted">
                  {stage.dueDate ? fmt(stage.dueDate) : '—'}
                </td>
                <td className="py-3 pr-4">
                  <StatusBadge status={stage.status} />
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-200 bg-slate-50/50 text-xs font-semibold uppercase tracking-wider dark:border-nord-3 dark:bg-nord-1/30">
            <td className="py-3 pr-4 text-slate-700 dark:text-nord-4" colSpan={2}>
              Итого по этапам
            </td>
            <td className="py-3 pr-4 text-right text-sm font-bold text-slate-900 dark:text-nord-6">
              {totalHours} ч
            </td>
            <td colSpan={4} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
