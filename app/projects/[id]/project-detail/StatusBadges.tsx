export function ProjectStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'active':
      return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Активен</span>;
    case 'on_hold':
      return <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" />На паузе</span>;
    case 'completed':
      return <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-400"><span className="h-1.5 w-1.5 rounded-full bg-blue-500" />Завершён</span>;
    case 'archived':
      return <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600 dark:bg-nord-1 dark:text-nord-muted">Архив</span>;
    default:
      return <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600 dark:bg-nord-1 dark:text-nord-muted">{status}</span>;
  }
}

export function PackageStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'approved':
      return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">УТВЕРЖДЁН</span>;
    case 'under_review':
      return <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">⏳ НА СОГЛАСОВАНИИ</span>;
    case 'rejected':
      return <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-bold text-rose-800 dark:bg-rose-950 dark:text-rose-300">ОТКЛОНЁН</span>;
    case 'archived':
      return <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-600 dark:bg-nord-1 dark:text-nord-muted">АРХИВ</span>;
    default:
      return <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-600 dark:bg-nord-1 dark:text-nord-4">ЧЕРНОВИК</span>;
  }
}
