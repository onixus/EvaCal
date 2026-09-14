/** Карточка показателя: подпись, значение, подсказка. Общая для аналитических экранов. */
export default function StatCard({
  title,
  value,
  hint,
  tone,
  size = 'md',
}: {
  title: string;
  value: string;
  hint?: string;
  tone?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const valueCls =
    size === 'lg'
      ? 'text-2xl font-extrabold'
      : size === 'sm'
        ? 'text-lg font-bold'
        : 'text-xl font-extrabold';
  return (
    <div className="card p-4">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-nord-muted">
        {title}
      </div>
      <div className={`${valueCls} ${tone ?? 'text-slate-900 dark:text-nord-6'}`}>{value}</div>
      {hint && <div className="text-[11px] text-slate-500 dark:text-nord-muted">{hint}</div>}
    </div>
  );
}
