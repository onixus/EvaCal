import { STATUS_LABELS } from "@/lib/roles";

const COLORS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600 dark:bg-nord-3 dark:text-nord-4",
  pending_approval: "bg-amber-100 text-amber-700 dark:bg-nord-yellow/20 dark:text-nord-yellow",
  approved: "bg-emerald-100 text-emerald-700 dark:bg-nord-green/20 dark:text-nord-green",
  planned: "bg-slate-100 text-slate-600 dark:bg-nord-3 dark:text-nord-4",
  in_progress: "bg-blue-100 text-blue-700 dark:bg-nord-frost2/20 dark:text-nord-frost2",
  done: "bg-emerald-100 text-emerald-700 dark:bg-nord-green/20 dark:text-nord-green",
  rejected: "bg-rose-100 text-rose-700 dark:bg-nord-red/20 dark:text-nord-redText",
};

export default function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge ${COLORS[status] ?? "bg-slate-100 text-slate-600"}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
