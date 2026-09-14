'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { DEAL_STATUS_LABELS, LOSS_REASONS, lossReasonLabel, type DealStatus } from '@/lib/actuals';
import { SUPPORTED_CURRENCIES, formatCurrency } from '@/lib/commercial';
import { PROJECT_SCHEDULE_LABELS, type ProjectSchedule } from '@/lib/schedule';

export interface DealProjectView {
  id: string;
  dealStatus: string;
  dealClosedAt: string | null;
  dealClosedBy: string | null;
  lossReason: string | null;
  lossComment: string | null;
  competitor: string | null;
  contractAmount: number | null;
  contractCurrency: string | null;
  wonCalculationId: string | null;
  actualsClosedAt: string | null;
  /** Контроль сроков по выигранной версии (E3); null — сделка не выиграна. */
  schedule: Pick<
    ProjectSchedule,
    'status' | 'plannedEnd' | 'forecastEnd' | 'currentSlipDays' | 'done' | 'total' | 'overdue'
  > | null;
  calculations: {
    id: string;
    version: number;
    status: string;
    currency: string;
    /** Рабочих этапов / с фактом — для прогресса. */
    stagesTotal: number;
    stagesWithActual: number;
  }[];
}

const STATUS_BADGE: Record<string, string> = {
  open: 'bg-sky-50 text-sky-700 dark:bg-nord-frost3/15 dark:text-nord-frost3',
  won: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  lost: 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
  cancelled: 'bg-slate-100 text-slate-600 dark:bg-nord-1 dark:text-nord-muted',
};

/**
 * Исход сделки на карточке проекта (Horizon E1). Пресейл закрывает сделку,
 * архитектор потом вносит факт по выигранной версии.
 */
export default function DealPanel({
  project,
  canEdit,
}: {
  project: DealProjectView;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<DealStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const approved = project.calculations.filter((c) => c.status === 'approved');
  const [form, setForm] = useState({
    wonCalculationId: approved[0]?.id ?? '',
    contractAmount: project.contractAmount?.toString() ?? '',
    contractCurrency: project.contractCurrency ?? approved[0]?.currency ?? 'RUB',
    lossReason: project.lossReason ?? 'price',
    lossComment: project.lossComment ?? '',
    competitor: project.competitor ?? '',
  });

  const won = project.calculations.find((c) => c.id === project.wonCalculationId);

  async function submit(status: DealStatus) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/deal`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dealStatus: status,
          wonCalculationId: form.wonCalculationId || null,
          contractAmount: form.contractAmount === '' ? null : Number(form.contractAmount),
          contractCurrency: form.contractCurrency,
          lossReason: form.lossReason,
          lossComment: form.lossComment,
          competitor: form.competitor,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Не удалось сохранить исход');
      }
      setMode(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-5" data-testid="deal-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-slate-900 dark:text-nord-6">Сделка</h2>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_BADGE[project.dealStatus] ?? STATUS_BADGE.open}`}
            >
              {DEAL_STATUS_LABELS[project.dealStatus as DealStatus] ?? project.dealStatus}
            </span>
          </div>
          <div className="text-xs text-slate-500 dark:text-nord-muted">
            {project.dealStatus === 'open' &&
              'Исход не зафиксирован. Отметьте, когда сделка решится.'}
            {project.dealStatus === 'won' && (
              <>
                Договор по версии v{won?.version ?? '?'}
                {project.contractAmount !== null && (
                  <>
                    {' '}
                    на{' '}
                    <strong className="text-slate-700 dark:text-nord-4">
                      {formatCurrency(project.contractAmount, project.contractCurrency ?? 'RUB')}
                    </strong>{' '}
                    без НДС
                  </>
                )}
                {project.contractAmount === null && ' (сумма не указана, маржа не считается)'}
                {project.dealClosedAt &&
                  ` · ${new Date(project.dealClosedAt).toLocaleDateString('ru-RU')}`}
              </>
            )}
            {project.dealStatus === 'lost' && (
              <>
                Причина: {lossReasonLabel(project.lossReason)}
                {project.competitor && ` · конкурент: ${project.competitor}`}
                {project.lossComment && ` · ${project.lossComment}`}
              </>
            )}
            {project.dealStatus === 'cancelled' &&
              (project.lossComment || 'Закупка не состоялась.')}
          </div>
          {project.dealStatus === 'won' && project.schedule && (
            <div className="text-xs text-slate-600 dark:text-nord-4" data-testid="deal-schedule">
              Сроки:{' '}
              <strong
                className={
                  project.schedule.status === 'late'
                    ? 'text-rose-700 dark:text-rose-300'
                    : project.schedule.status === 'at_risk'
                      ? 'text-amber-700 dark:text-nord-yellow'
                      : 'text-slate-800 dark:text-nord-4'
                }
              >
                {PROJECT_SCHEDULE_LABELS[project.schedule.status]}
              </strong>
              {' · '}план до {new Date(project.schedule.plannedEnd).toLocaleDateString('ru-RU')}
              {project.schedule.currentSlipDays > 0 && (
                <>
                  , прогноз {new Date(project.schedule.forecastEnd).toLocaleDateString('ru-RU')} (+
                  {project.schedule.currentSlipDays} дн.)
                </>
              )}
              {' · '}этапов {project.schedule.done}/{project.schedule.total}
              {project.schedule.overdue > 0 && `, просрочено ${project.schedule.overdue}`}
            </div>
          )}
          {project.dealStatus === 'won' && won && (
            <div className="text-xs text-slate-600 dark:text-nord-4">
              Факт внесён по {won.stagesWithActual} из {won.stagesTotal} этапов
              {project.actualsClosedAt ? ' · факт закрыт' : ''}
              {' · '}
              <Link href={`/architect/${won.id}`} className="underline">
                открыть расчёт
              </Link>
            </div>
          )}
        </div>
        {canEdit && mode === null && (
          <div className="flex flex-wrap gap-2">
            {project.dealStatus !== 'won' && (
              <button
                className="btn-primary text-xs"
                disabled={approved.length === 0}
                title={approved.length === 0 ? 'Нужен утверждённый расчёт' : undefined}
                onClick={() => setMode('won')}
              >
                Выиграно
              </button>
            )}
            {project.dealStatus !== 'lost' && (
              <button className="btn-secondary text-xs" onClick={() => setMode('lost')}>
                Проиграно
              </button>
            )}
            {project.dealStatus !== 'cancelled' && (
              <button className="btn-ghost text-xs" onClick={() => setMode('cancelled')}>
                Отменено
              </button>
            )}
            {project.dealStatus !== 'open' && !project.actualsClosedAt && (
              <button className="btn-ghost text-xs" disabled={busy} onClick={() => submit('open')}>
                Переоткрыть
              </button>
            )}
          </div>
        )}
      </div>

      {mode && (
        <form
          className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-4 dark:border-nord-3 dark:bg-nord-1/40"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(mode);
          }}
        >
          {error && (
            <div className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
              {error}
            </div>
          )}
          {mode === 'won' && (
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="label text-xs">Версия договора</label>
                <select
                  className="input text-sm"
                  value={form.wonCalculationId}
                  onChange={(e) => setForm({ ...form, wonCalculationId: e.target.value })}
                >
                  {approved.map((c) => (
                    <option key={c.id} value={c.id}>
                      v{c.version}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label text-xs">Сумма без НДС</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="input text-sm"
                  value={form.contractAmount}
                  onChange={(e) => setForm({ ...form, contractAmount: e.target.value })}
                />
              </div>
              <div>
                <label className="label text-xs">Валюта</label>
                <select
                  className="input text-sm"
                  value={form.contractCurrency}
                  onChange={(e) => setForm({ ...form, contractCurrency: e.target.value })}
                >
                  {Object.values(SUPPORTED_CURRENCIES).map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
          {mode === 'lost' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label text-xs">Причина *</label>
                <select
                  className="input text-sm"
                  value={form.lossReason}
                  onChange={(e) => setForm({ ...form, lossReason: e.target.value })}
                >
                  {LOSS_REASONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label text-xs">Конкурент</label>
                <input
                  className="input text-sm"
                  value={form.competitor}
                  onChange={(e) => setForm({ ...form, competitor: e.target.value })}
                />
              </div>
            </div>
          )}
          {mode !== 'won' && (
            <div>
              <label className="label text-xs">Комментарий</label>
              <input
                className="input text-sm"
                value={form.lossComment}
                onChange={(e) => setForm({ ...form, lossComment: e.target.value })}
              />
            </div>
          )}
          <div className="flex gap-2">
            <button type="submit" className="btn-primary text-xs" disabled={busy}>
              {busy ? 'Сохраняю…' : `Отметить: ${DEAL_STATUS_LABELS[mode].toLowerCase()}`}
            </button>
            <button type="button" className="btn-ghost text-xs" onClick={() => setMode(null)}>
              Отмена
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
