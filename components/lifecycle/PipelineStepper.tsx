import Link from 'next/link';
import { formatDays, LIFECYCLE_STEPS, type LifecycleState } from '@/lib/lifecycle';

/**
 * Конвейер проекта на карточке: все шаги в одну строку, текущий выделен,
 * под ним — сколько проект тут стоит и что нужно сделать дальше. Это
 * единственное место, где пользователь видит весь путь целиком.
 */
export default function PipelineStepper({ state }: { state: LifecycleState }) {
  const blocked = state.attention === 'rejected';
  const paused = state.attention === 'paused';
  const lost = state.attention === 'lost';

  const currentTone = blocked
    ? 'border-rose-400 bg-rose-50 text-rose-800 dark:border-nord-red dark:bg-nord-red/15 dark:text-nord-redText'
    : paused || lost
      ? 'border-slate-300 bg-slate-100 text-slate-700 dark:border-nord-3 dark:bg-nord-1 dark:text-nord-4'
      : state.freshness === 'stale'
        ? 'border-rose-400 bg-rose-50 text-rose-800 dark:border-nord-red dark:bg-nord-red/15 dark:text-nord-redText'
        : state.freshness === 'warn'
          ? 'border-amber-400 bg-amber-50 text-amber-800 dark:border-nord-yellow dark:bg-nord-yellow/15 dark:text-nord-yellow'
          : 'border-brand-600 bg-brand-50 text-brand-800 dark:border-nord-frost2 dark:bg-nord-frost4/20 dark:text-nord-frost2';

  return (
    <div className="space-y-3">
      <ol
        className="grid grid-cols-2 gap-1 sm:grid-cols-4 xl:grid-cols-8"
        aria-label="Этапы проекта"
      >
        {LIFECYCLE_STEPS.map((step, i) => {
          const done = i < state.index;
          const current = i === state.index;
          const cls = current
            ? `${currentTone} border`
            : done
              ? 'border border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-nord-green/40 dark:bg-nord-green/15 dark:text-nord-green'
              : 'border border-dashed border-slate-200 bg-transparent text-slate-400 dark:border-nord-3 dark:text-nord-muted';
          return (
            <li
              key={step.id}
              aria-current={current ? 'step' : undefined}
              className={`flex min-w-0 flex-col gap-0.5 rounded-lg px-2.5 py-2 ${cls}`}
              title={`${step.label} — ${step.owner}`}
            >
              <span className="flex min-w-0 items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider">
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] ${
                    done
                      ? 'bg-emerald-600 text-white dark:bg-nord-green dark:text-nord-0'
                      : current
                        ? 'bg-current text-white'
                        : 'bg-slate-200 text-slate-500 dark:bg-nord-3 dark:text-nord-muted'
                  }`}
                >
                  {done ? '✓' : current && blocked ? '!' : i + 1}
                </span>
                <span className={`truncate ${current ? '' : 'font-semibold'}`}>{step.short}</span>
              </span>
              <span className="truncate text-[11px] opacity-80">
                {current
                  ? state.stage === 'deal_closed'
                    ? state.note
                    : formatDays(state.days)
                  : step.owner}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <p className="text-slate-600 dark:text-nord-4">
          <span className="font-semibold text-slate-900 dark:text-nord-6">{state.note}.</span>{' '}
          {state.stage !== 'deal_closed' && (
            <span className="text-slate-500 dark:text-nord-muted">
              На этапе с{' '}
              {new Date(state.enteredAt).toLocaleDateString('ru-RU', {
                day: 'numeric',
                month: 'short',
              })}{' '}
              ({formatDays(state.days)}).
            </span>
          )}
        </p>
        {state.next && !paused && (
          <Link
            href={state.next.href}
            className={blocked ? 'btn-danger' : 'btn-primary'}
            data-testid="lifecycle-next"
          >
            {state.next.label} →
          </Link>
        )}
      </div>
    </div>
  );
}
