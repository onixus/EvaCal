"use client";

import { roleLabel } from "@/lib/roles";
import StatusBadge from "./StatusBadge";

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

function fmt(d: string | Date): string {
  return new Date(d).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function StageTable({ stages }: { stages: StageRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-nord-2 dark:text-nord-3">
            <th className="py-2 pr-4">Этап</th>
            <th className="py-2 pr-4">Роль</th>
            <th className="py-2 pr-4">Трудозатраты, ч</th>
            <th className="py-2 pr-4">Начало</th>
            <th className="py-2 pr-4">Окончание</th>
            <th className="py-2 pr-4">Срок согласования</th>
            <th className="py-2 pr-4">Статус</th>
          </tr>
        </thead>
        <tbody>
          {stages.map((stage) => (
            <tr
              key={stage.id}
              className={`border-b border-slate-100 dark:border-nord-2 ${
                stage.isApprovalTask ? "bg-amber-50/50 dark:bg-nord-yellow/10" : ""
              }`}
            >
              <td className="py-2 pr-4">
                {stage.isApprovalTask ? "⏳ " : ""}
                {stage.parallel && (
                  <span
                    className="mr-1 rounded bg-sky-100 px-1 text-[10px] font-medium text-sky-700 dark:bg-nord-frost4/20 dark:text-nord-frost2"
                    title="Выполняется параллельно с предыдущим этапом"
                  >
                    ∥
                  </span>
                )}
                {stage.name}
                {stage.requirements && (
                  <div className="mt-0.5 text-xs font-normal text-slate-500 dark:text-nord-3">
                    {stage.requirements}
                  </div>
                )}
              </td>
              <td className="py-2 pr-4 text-slate-600 dark:text-nord-4">{roleLabel(stage.role)}</td>
              <td className="py-2 pr-4">{stage.isApprovalTask ? "—" : stage.hours}</td>
              <td className="py-2 pr-4">{fmt(stage.startDate)}</td>
              <td className="py-2 pr-4">{fmt(stage.endDate)}</td>
              <td className="py-2 pr-4">{stage.dueDate ? fmt(stage.dueDate) : "—"}</td>
              <td className="py-2 pr-4">
                <StatusBadge status={stage.status} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="pt-2 pr-4 font-medium" colSpan={2}>
              Итого по этапам
            </td>
            <td className="pt-2 pr-4 font-medium">
              {stages.filter((s) => !s.isApprovalTask).reduce((sum, s) => sum + s.hours, 0)}
            </td>
            <td colSpan={4} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
