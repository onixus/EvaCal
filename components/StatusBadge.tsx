import { STATUS_LABELS } from "@/lib/roles";

const COLORS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  pending_approval: "bg-amber-100 text-amber-700",
  approved: "bg-emerald-100 text-emerald-700",
  planned: "bg-slate-100 text-slate-600",
  in_progress: "bg-blue-100 text-blue-700",
  done: "bg-emerald-100 text-emerald-700",
  rejected: "bg-rose-100 text-rose-700",
};

export default function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge ${COLORS[status] ?? "bg-slate-100 text-slate-600"}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
