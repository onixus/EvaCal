import { formatDays, lifecycleStep, type LifecycleState } from '@/lib/lifecycle';

/**
 * Компактный маркер этапа для списков: имя шага и сколько проект на нём стоит.
 * Цвет — по свежести и тревоге, чтобы зависшие проекты читались с одного
 * взгляда, без чтения дат.
 */
export function stageChipClass(state: Pick<LifecycleState, 'attention' | 'freshness'>): string {
  if (state.attention === 'rejected') return 'chip-block';
  if (state.attention === 'paused' || state.attention === 'lost') return 'chip-muted';
  if (state.freshness === 'stale') return 'chip-block';
  if (state.freshness === 'warn') return 'chip-warn';
  return 'chip-info';
}

export default function StageChip({
  state,
  showDays = true,
}: {
  state: LifecycleState;
  showDays?: boolean;
}) {
  const step = lifecycleStep(state.stage);
  const title = `${step.label}: ${state.note}. На этапе ${formatDays(state.days)}`;
  return (
    <span className="inline-flex flex-wrap items-center gap-1" title={title}>
      <span className={stageChipClass(state)}>
        {state.attention === 'rejected' ? '! ' : ''}
        {step.short}
      </span>
      {showDays && state.stage !== 'deal_closed' && (
        <span className="nums text-[11px] text-slate-500 dark:text-nord-muted">
          {formatDays(state.days)}
        </span>
      )}
    </span>
  );
}
