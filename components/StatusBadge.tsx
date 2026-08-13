import { STATUS_LABELS } from '@/lib/roles';

const STYLES: Record<string, { bg: string; dot: string }> = {
  draft: {
    bg: 'bg-slate-100 text-slate-700 border border-slate-200/60 dark:bg-nord-3/60 dark:text-nord-4 dark:border-nord-3',
    dot: 'bg-slate-400 dark:bg-nord-4',
  },
  pending_approval: {
    bg: 'bg-amber-50 text-amber-800 border border-amber-200/70 dark:bg-nord-yellow/15 dark:text-nord-yellow dark:border-nord-yellow/30',
    dot: 'bg-amber-500 animate-pulse',
  },
  approved: {
    bg: 'bg-emerald-50 text-emerald-800 border border-emerald-200/70 dark:bg-nord-green/15 dark:text-nord-green dark:border-nord-green/30',
    dot: 'bg-emerald-500',
  },
  planned: {
    bg: 'bg-slate-100 text-slate-700 border border-slate-200/60 dark:bg-nord-3/60 dark:text-nord-4 dark:border-nord-3',
    dot: 'bg-slate-400',
  },
  in_progress: {
    bg: 'bg-blue-50 text-blue-800 border border-blue-200/70 dark:bg-nord-frost2/15 dark:text-nord-frost2 dark:border-nord-frost2/30',
    dot: 'bg-blue-500 animate-pulse',
  },
  done: {
    bg: 'bg-emerald-50 text-emerald-800 border border-emerald-200/70 dark:bg-nord-green/15 dark:text-nord-green dark:border-nord-green/30',
    dot: 'bg-emerald-500',
  },
  rejected: {
    bg: 'bg-rose-50 text-rose-800 border border-rose-200/70 dark:bg-nord-red/15 dark:text-nord-redText dark:border-nord-red/30',
    dot: 'bg-rose-500',
  },
};

export default function StatusBadge({ status }: { status: string }) {
  const style = STYLES[status] ?? {
    bg: 'bg-slate-100 text-slate-700 border border-slate-200',
    dot: 'bg-slate-400',
  };

  return (
    <span className={`badge font-medium shadow-xs ${style.bg}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
