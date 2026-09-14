'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { roleLabel } from '@/lib/roles';
import { accuracyTone, type CalculationAccuracy, type ActualMargin } from '@/lib/actuals';
import { formatCurrency } from '@/lib/commercial';
import { PROJECT_SCHEDULE_LABELS, type ProjectSchedule } from '@/lib/schedule';

interface StageView {
  id: string;
  name: string;
  role: string;
  hours: number;
  isApprovalTask: boolean;
  actualHours: number | null;
  startDate: string;
  endDate: string;
  actualStartDate: string | null;
  actualEndDate: string | null;
  actualNote: string | null;
}

interface Summary {
  calculationId: string;
  isWonVersion: boolean;
  actualsClosedAt: string | null;
  contractCurrency: string | null;
  pmHours: number;
  actualPmHours: number | null;
  stages: StageView[];
  accuracy: CalculationAccuracy;
  margin: ActualMargin;
  schedule: ProjectSchedule | null;
}

const SCHEDULE_TONE: Record<ProjectSchedule['status'], string> = {
  not_started: 'text-slate-500 dark:text-nord-muted',
  on_track: 'text-emerald-700 dark:text-emerald-400',
  at_risk: 'text-amber-700 dark:text-nord-yellow',
  late: 'text-rose-700 dark:text-rose-300',
  completed: 'text-slate-900 dark:text-nord-6',
};

function fmtD(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
    : '—';
}

function dayInput(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '';
}

const TONE: Record<ReturnType<typeof accuracyTone>, string> = {
  ok: 'text-emerald-700 dark:text-emerald-400',
  warn: 'text-amber-700 dark:text-nord-yellow',
  bad: 'text-rose-700 dark:text-rose-300',
  none: 'text-slate-400 dark:text-nord-muted',
};

function pct(r: number | null): string {
  return r === null ? '—' : `${r > 0 ? '+' : ''}${Math.round(r * 100)}%`;
}

/**
 * Факт по этапам выигранной версии (Horizon E1). Показывается только у
 * версии, по которой подписан договор; иначе панели нет.
 */
export default function ActualsPanel({
  calculationId,
  role,
}: {
  calculationId: string;
  role: string;
}) {
  const router = useRouter();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pmDraft, setPmDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [csv, setCsv] = useState('');
  const [importPreview, setImportPreview] = useState<{
    matched: { name: string; hours: number }[];
    unmatched: string[];
    invalid: string[];
  } | null>(null);

  async function load() {
    const res = await fetch(`/api/calculations/${calculationId}/actuals`, { cache: 'no-store' });
    if (!res.ok) return;
    const data = (await res.json()) as Summary;
    setSummary(data);
    setDrafts(Object.fromEntries(data.stages.map((s) => [s.id, s.actualHours?.toString() ?? ''])));
    setPmDraft(data.actualPmHours?.toString() ?? '');
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calculationId]);

  if (!summary || !summary.isWonVersion) return null;

  const locked = Boolean(summary.actualsClosedAt) && role !== 'admin';
  const canReopen = role === 'admin';

  async function call(url: string, init: RequestInit): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        ...init,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Ошибка');
      }
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveStage(stage: StageView) {
    const raw = drafts[stage.id] ?? '';
    const ok = await call(`/api/calculations/${calculationId}/stages/${stage.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ actualHours: raw === '' ? null : Number(raw) }),
    });
    if (ok) await load();
  }

  async function saveDate(
    stage: StageView,
    key: 'actualStartDate' | 'actualEndDate',
    value: string,
  ) {
    if (dayInput(stage[key]) === value) return;
    const ok = await call(`/api/calculations/${calculationId}/stages/${stage.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ [key]: value || null }),
    });
    if (ok) await load();
  }

  async function savePm() {
    const ok = await call(`/api/calculations/${calculationId}/actuals`, {
      method: 'PATCH',
      body: JSON.stringify({ actualPmHours: pmDraft === '' ? null : Number(pmDraft) }),
    });
    if (ok) await load();
  }

  async function toggleClosed(closed: boolean) {
    const ok = await call(`/api/calculations/${calculationId}/actuals/close`, {
      method: 'POST',
      body: JSON.stringify({ closed }),
    });
    if (ok) {
      await load();
      router.refresh();
    }
  }

  async function runImport(dryRun: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/calculations/${calculationId}/actuals/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv, dryRun }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Ошибка импорта');
      setImportPreview(data);
      if (!dryRun) {
        setCsv('');
        setImportPreview(null);
        await load();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  }

  const acc = summary.accuracy;
  const tone = TONE[accuracyTone(acc.deviation)];

  return (
    <div className="card p-5" data-testid="actuals-panel">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">Факт по выигранной версии</h2>
          <p className="text-xs text-slate-500 dark:text-nord-muted">
            Внесено по {acc.covered} из {acc.total} этапов
            {summary.actualsClosedAt && (
              <> · факт закрыт {new Date(summary.actualsClosedAt).toLocaleDateString('ru-RU')}</>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          {!summary.actualsClosedAt ? (
            <button
              className="btn-secondary text-xs"
              disabled={busy || acc.covered === 0}
              onClick={() => toggleClosed(true)}
            >
              Закрыть факт
            </button>
          ) : (
            canReopen && (
              <button
                className="btn-ghost text-xs"
                disabled={busy}
                onClick={() => toggleClosed(false)}
              >
                Переоткрыть факт
              </button>
            )
          )}
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded-lg bg-rose-50 p-2 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </div>
      )}

      {summary.schedule && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="schedule-stats">
          <Stat
            title="Сроки"
            value={PROJECT_SCHEDULE_LABELS[summary.schedule.status]}
            tone={SCHEDULE_TONE[summary.schedule.status]}
            hint={`этапов завершено ${summary.schedule.done} из ${summary.schedule.total}${summary.schedule.overdue ? `, просрочено ${summary.schedule.overdue}` : ''}`}
          />
          <Stat
            title="Окончание по плану"
            value={fmtD(summary.schedule.plannedEnd)}
            hint={`старт ${fmtD(summary.schedule.plannedStart)}`}
          />
          <Stat
            title="Прогноз окончания"
            value={fmtD(summary.schedule.forecastEnd)}
            tone={
              summary.schedule.currentSlipDays > 0
                ? SCHEDULE_TONE[summary.schedule.status]
                : undefined
            }
            hint={
              summary.schedule.currentSlipDays > 0
                ? `сдвиг +${summary.schedule.currentSlipDays} дн.`
                : 'без сдвига'
            }
          />
          <Stat
            title="Медиана сдвига этапов"
            value={
              summary.schedule.medianEndSlipDays === null
                ? '—'
                : `${summary.schedule.medianEndSlipDays > 0 ? '+' : ''}${summary.schedule.medianEndSlipDays} дн.`
            }
            hint="по завершённым этапам"
          />
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat title="План (по этапам с фактом)" value={`${acc.plannedCovered} ч`} />
        <Stat title="Факт" value={`${acc.actualCovered} ч`} />
        <Stat title="Отклонение" value={pct(acc.deviation)} tone={tone} />
        <Stat
          title="Фактическая маржа"
          value={
            summary.margin.margin === null ? '—' : `${Math.round(summary.margin.margin * 100)}%`
          }
          hint={
            summary.margin.margin === null
              ? 'нет суммы договора'
              : `себестоимость ${formatCurrency(summary.margin.actualCost, summary.contractCurrency ?? 'RUB')}${summary.margin.partial ? ', факт неполный' : ''}`
          }
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200/80 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:border-nord-3 dark:text-nord-muted">
              <th className="py-2 pr-4">Этап</th>
              <th className="py-2 pr-4">Роль</th>
              <th className="py-2 pr-4 text-right">План</th>
              <th className="py-2 pr-4 text-right">Факт, ч</th>
              <th className="py-2 pr-4 text-right">Откл.</th>
              <th className="py-2 pr-4">Срок по плану</th>
              <th className="py-2 pr-4">Факт: начало</th>
              <th className="py-2 pr-4">Факт: окончание</th>
              <th className="py-2 pr-4 text-right">Сдвиг</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-nord-3">
            {summary.stages
              .filter((s) => !s.isApprovalTask)
              .map((s) => {
                // Считается по строке, а не по имени: имена этапов повторяются.
                const dev =
                  s.actualHours === null || s.hours <= 0
                    ? null
                    : Math.round((s.actualHours / s.hours - 1) * 100) / 100;
                return (
                  <tr key={s.id}>
                    <td className="py-2 pr-4 font-medium text-slate-900 dark:text-nord-5">
                      {s.name}
                    </td>
                    <td className="py-2 pr-4 text-xs text-slate-600 dark:text-nord-4">
                      {roleLabel(s.role)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">{s.hours} ч</td>
                    <td className="py-2 pr-4 text-right">
                      <input
                        type="number"
                        min={0}
                        step="0.5"
                        className="input w-24 text-right text-sm"
                        disabled={locked || busy}
                        value={drafts[s.id] ?? ''}
                        onChange={(e) => setDrafts({ ...drafts, [s.id]: e.target.value })}
                        onBlur={() => {
                          if ((drafts[s.id] ?? '') !== (s.actualHours?.toString() ?? ''))
                            void saveStage(s);
                        }}
                        aria-label={`Факт часов: ${s.name}`}
                      />
                    </td>
                    <td
                      className={`py-2 pr-4 text-right text-xs font-semibold ${TONE[accuracyTone(dev)]}`}
                    >
                      {pct(dev)}
                    </td>
                    <td className="py-2 pr-4 text-xs tabular-nums text-slate-500 dark:text-nord-muted">
                      {fmtD(s.startDate)} – {fmtD(s.endDate)}
                    </td>
                    <td className="py-2 pr-4">
                      <input
                        type="date"
                        className="input w-36 text-xs"
                        disabled={locked || busy}
                        defaultValue={dayInput(s.actualStartDate)}
                        onBlur={(e) => void saveDate(s, 'actualStartDate', e.target.value)}
                        aria-label={`Факт начала: ${s.name}`}
                      />
                    </td>
                    <td className="py-2 pr-4">
                      <input
                        type="date"
                        className="input w-36 text-xs"
                        disabled={locked || busy}
                        defaultValue={dayInput(s.actualEndDate)}
                        onBlur={(e) => void saveDate(s, 'actualEndDate', e.target.value)}
                        aria-label={`Факт окончания: ${s.name}`}
                      />
                    </td>
                    <td className="py-2 pr-4 text-right text-xs tabular-nums">
                      <StageSlip stage={summary.schedule?.stages.find((x) => x.id === s.id)} />
                    </td>
                  </tr>
                );
              })}
            <tr>
              <td className="py-2 pr-4 font-medium text-slate-900 dark:text-nord-5">
                Руководитель проекта
              </td>
              <td className="py-2 pr-4 text-xs text-slate-600 dark:text-nord-4">РП</td>
              <td className="py-2 pr-4 text-right tabular-nums">{summary.pmHours} ч</td>
              <td className="py-2 pr-4 text-right">
                <input
                  type="number"
                  min={0}
                  step="0.5"
                  className="input w-24 text-right text-sm"
                  disabled={locked || busy}
                  value={pmDraft}
                  onChange={(e) => setPmDraft(e.target.value)}
                  onBlur={() => {
                    if (pmDraft !== (summary.actualPmHours?.toString() ?? '')) void savePm();
                  }}
                  aria-label="Факт часов РП"
                />
              </td>
              <td colSpan={5} />
            </tr>
          </tbody>
        </table>
      </div>

      {!locked && (
        <details className="mt-4 text-xs">
          <summary className="cursor-pointer text-slate-600 dark:text-nord-4">
            Импорт факта из CSV (этап;часы[;начало;окончание])
          </summary>
          <div className="mt-2 space-y-2">
            <textarea
              className="input h-28 w-full font-mono text-xs"
              placeholder={'Обследование;12\nПроектирование;40;2026-03-01;2026-03-20'}
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
            />
            <div className="flex gap-2">
              <button
                className="btn-secondary text-xs"
                disabled={busy || !csv.trim()}
                onClick={() => runImport(true)}
              >
                Проверить
              </button>
              <button
                className="btn-primary text-xs"
                disabled={busy || !importPreview || importPreview.matched.length === 0}
                onClick={() => runImport(false)}
              >
                Применить
              </button>
            </div>
            {importPreview && (
              <div className="space-y-1 text-slate-600 dark:text-nord-4">
                <div>
                  Совпало:{' '}
                  {importPreview.matched.map((m) => `${m.name} — ${m.hours} ч`).join('; ') || '—'}
                </div>
                {importPreview.unmatched.length > 0 && (
                  <div className="text-amber-700 dark:text-nord-yellow">
                    Не найдены этапы: {importPreview.unmatched.join(', ')}
                  </div>
                )}
                {importPreview.invalid.length > 0 && (
                  <div className="text-rose-700 dark:text-rose-300">
                    Не разобраны строки: {importPreview.invalid.join(' | ')}
                  </div>
                )}
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

function StageSlip({ stage }: { stage?: ProjectSchedule['stages'][number] }) {
  if (!stage) return <>—</>;
  if (stage.status === 'overdue') {
    return (
      <span className="font-semibold text-rose-700 dark:text-rose-300">
        просрочен {stage.overdueDays} дн.
      </span>
    );
  }
  if (stage.endSlipDays === null) return <>—</>;
  const cls =
    stage.endSlipDays > 0
      ? 'text-rose-700 dark:text-rose-300'
      : stage.endSlipDays < 0
        ? 'text-sky-700 dark:text-nord-frost2'
        : '';
  return (
    <span className={cls}>
      {stage.endSlipDays > 0 ? '+' : ''}
      {stage.endSlipDays} дн.
    </span>
  );
}

function Stat({
  title,
  value,
  hint,
  tone,
}: {
  title: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 dark:border-nord-3 dark:bg-nord-1/40">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-nord-muted">
        {title}
      </div>
      <div className={`text-lg font-bold ${tone ?? 'text-slate-900 dark:text-nord-6'}`}>
        {value}
      </div>
      {hint && <div className="text-[11px] text-slate-500 dark:text-nord-muted">{hint}</div>}
    </div>
  );
}
