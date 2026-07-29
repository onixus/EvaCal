"use client";

import { roleLabel } from "@/lib/roles";

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
}

const ROLE_COLORS: Record<string, string> = {
  consultant: "bg-sky-500",
  developer: "bg-violet-500",
  engineer: "bg-orange-500",
  analyst: "bg-teal-500",
  architect: "bg-indigo-500",
  customer: "bg-amber-400",
  other: "bg-slate-400",
};

function fmtDate(d: string | Date): string {
  return new Date(d).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

export default function GanttChart({ stages }: { stages: GanttStage[] }) {
  if (stages.length === 0) {
    return <p className="text-sm text-slate-500">Нет этапов для отображения.</p>;
  }

  const starts = stages.map((s) => new Date(s.startDate).getTime());
  const ends = stages.map((s) => new Date(s.endDate).getTime());
  const rangeStart = Math.min(...starts);
  const rangeEnd = Math.max(...ends, rangeStart + 1000 * 60 * 60 * 24);
  const rangeMs = Math.max(rangeEnd - rangeStart, 1);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-3 text-xs text-slate-500 mb-1 dark:text-nord-3">
        {Object.entries(ROLE_COLORS).map(([role, color]) => (
          <span key={role} className="inline-flex items-center gap-1">
            <span className={`h-2.5 w-2.5 rounded-sm ${color}`} />
            {roleLabel(role)}
          </span>
        ))}
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[640px] space-y-1.5">
          {stages.map((stage) => {
            const start = new Date(stage.startDate).getTime();
            const end = new Date(stage.endDate).getTime();
            const leftPct = ((start - rangeStart) / rangeMs) * 100;
            const widthPct = Math.max(((end - start) / rangeMs) * 100, 0.6);
            return (
              <div key={stage.id} className="flex items-center gap-3">
                <div className="w-56 shrink-0 truncate text-sm text-slate-700 dark:text-nord-4" title={stage.name}>
                  {stage.isApprovalTask ? "⏳ " : ""}
                  {stage.name}
                </div>
                <div className="relative h-6 flex-1 rounded bg-slate-100 dark:bg-nord-0">
                  <div
                    className={`absolute h-6 rounded ${
                      stage.isApprovalTask
                        ? "bg-amber-400/70 border border-dashed border-amber-500 dark:bg-nord-yellow/40 dark:border-nord-yellow"
                        : ROLE_COLORS[stage.role] ?? "bg-slate-400"
                    }`}
                    style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                    title={`${fmtDate(stage.startDate)} — ${fmtDate(stage.endDate)}${
                      stage.isApprovalTask ? "" : ` · ${stage.hours} ч`
                    }${stage.requirements ? `\n${stage.requirements}` : ""}`}
                  />
                </div>
                <div className="w-28 shrink-0 text-right text-xs text-slate-500 dark:text-nord-3">
                  {fmtDate(stage.startDate)}–{fmtDate(stage.endDate)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
