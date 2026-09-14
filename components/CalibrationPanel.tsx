'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { CalibrationReport, Neighbour } from '@/lib/calibration';
import { withShareHeaders } from '@/lib/shareClient';

/**
 * «Калибровка по похожим проектам»: показывает, насколько утверждённые расчёты
 * того же шаблона с похожими ответами разошлись с формулой, и что это значит
 * для текущей оценки. Одна и та же панель для пресейла и архитектора; ссылки
 * на соседей строятся только когда сервер раскрыл их названия (staff).
 */

const CONFIDENCE_BADGE: Record<CalibrationReport['confidence'], { label: string; cls: string }> = {
  none: {
    label: 'нет данных',
    cls: 'bg-slate-100 text-slate-600 dark:bg-nord-3 dark:text-nord-4',
  },
  low: {
    label: 'низкая уверенность',
    cls: 'bg-amber-100 text-amber-800 dark:bg-nord-yellow/20 dark:text-nord-yellow',
  },
  medium: {
    label: 'средняя уверенность',
    cls: 'bg-sky-100 text-sky-800 dark:bg-nord-frost2/20 dark:text-nord-frost2',
  },
  high: {
    label: 'высокая уверенность',
    cls: 'bg-emerald-100 text-emerald-800 dark:bg-nord-frost3/20 dark:text-nord-frost3',
  },
};

function fmtRatio(r: number | null): string {
  if (r === null) return '—';
  return `×${r.toFixed(2)}`;
}

function fmtPct(r: number | null): string {
  if (r === null) return '—';
  const pct = Math.round((r - 1) * 100);
  return `${pct > 0 ? '+' : ''}${pct}%`;
}

function ratioTone(r: number | null): string {
  if (r === null) return 'text-slate-500 dark:text-nord-muted';
  if (r > 1.15) return 'text-rose-700 dark:text-nord-auroraRed';
  if (r < 0.9) return 'text-emerald-700 dark:text-nord-frost3';
  return 'text-slate-900 dark:text-nord-6';
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
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
    <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3.5 dark:border-nord-3 dark:bg-nord-1/40">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-nord-muted">
        {title}
      </div>
      <div className={`mt-2 text-2xl font-bold ${tone ?? 'text-slate-900 dark:text-nord-6'}`}>
        {value}
      </div>
      {hint && <div className="mt-1 text-[11px] text-slate-400 dark:text-nord-muted">{hint}</div>}
    </div>
  );
}

function NeighbourRow({ n, reveal }: { n: Neighbour; reveal: boolean }) {
  const [open, setOpen] = useState(false);
  const simPct = Math.round(n.similarity * 100);
  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-xs text-slate-400 hover:text-slate-700 dark:text-nord-muted"
          aria-label={open ? 'Скрыть ответы' : 'Показать ответы'}
        >
          {open ? '▾' : '▸'}
        </button>
        <span className="min-w-0 flex-1 truncate">
          {reveal ? (
            <Link
              href={`/calculations/${n.id}`}
              className="font-medium text-brand-700 hover:underline dark:text-nord-frost2"
            >
              {n.label}
            </Link>
          ) : (
            <span className="font-medium text-slate-800 dark:text-nord-5">{n.label}</span>
          )}
          {n.customer && (
            <span className="ml-2 text-xs text-slate-500 dark:text-nord-muted">{n.customer}</span>
          )}
        </span>
        <span
          className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-nord-3 dark:text-nord-4"
          title="Похожесть ответов опросника"
        >
          {simPct}% похоже
        </span>
        <span className="text-xs text-slate-500 dark:text-nord-muted">
          формула {n.formulaHours} ч → утверждено{' '}
          <strong className="text-slate-800 dark:text-nord-5">{n.actualHours} ч</strong>
        </span>
        <span className={`text-xs font-semibold ${ratioTone(n.ratio)}`}>{fmtPct(n.ratio)}</span>
        <span className="text-xs text-slate-500 dark:text-nord-muted">{n.durationDays} дн.</span>
        {n.riskHours > 0 && (
          <span className="text-xs text-amber-700 dark:text-nord-yellow">
            риски {n.riskHours} ч
          </span>
        )}
        <span className="text-[11px] text-slate-400 dark:text-nord-muted">
          {fmtDate(n.approvedAt)}
        </span>
      </div>
      {open && n.answers.length > 0 && (
        <div className="mt-2 overflow-x-auto rounded-lg border border-slate-100 dark:border-nord-3">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500 dark:bg-nord-1/40 dark:text-nord-muted">
              <tr>
                <th className="px-3 py-1.5 font-semibold">Вопрос</th>
                <th className="px-3 py-1.5 font-semibold">У нас</th>
                <th className="px-3 py-1.5 font-semibold">У них</th>
                <th className="px-3 py-1.5 font-semibold">Совпадение</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-nord-3">
              {n.answers.map((a) => (
                <tr
                  key={a.key}
                  className={a.closeness < 1 ? 'bg-amber-50/40 dark:bg-nord-yellow/5' : ''}
                >
                  <td className="px-3 py-1.5 text-slate-600 dark:text-nord-4">{a.label}</td>
                  <td className="px-3 py-1.5 font-medium text-slate-800 dark:text-nord-5">
                    {a.targetValue}
                  </td>
                  <td className="px-3 py-1.5 text-slate-800 dark:text-nord-5">
                    {a.neighbourValue}
                  </td>
                  <td className="px-3 py-1.5 text-slate-500 dark:text-nord-muted">
                    {Math.round(a.closeness * 100)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </li>
  );
}

export default function CalibrationPanel({
  calculationId,
  compact = false,
}: {
  calculationId: string;
  /** Пресейл: без ссылок на соседей и с укороченной таблицей этапов. */
  compact?: boolean;
}) {
  const [report, setReport] = useState<CalibrationReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/calculations/${calculationId}/calibration`, {
      headers: withShareHeaders(calculationId),
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }
        return (await res.json()) as CalibrationReport;
      })
      .then((r) => {
        if (!cancelled) setReport(r);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Ошибка');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [calculationId]);

  const header = (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 className="font-semibold text-slate-900 dark:text-nord-6">
          🎯 Калибровка по похожим проектам
        </h2>
        <p className="text-xs text-slate-500 dark:text-nord-muted">
          Как утверждённые расчёты этого шаблона с похожими ответами разошлись с формулой.
        </p>
      </div>
      {report && (
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${CONFIDENCE_BADGE[report.confidence].cls}`}
        >
          {CONFIDENCE_BADGE[report.confidence].label}
        </span>
      )}
    </div>
  );

  if (loading) {
    return (
      <div className="card p-5">
        {header}
        <p className="text-sm text-slate-500 dark:text-nord-muted">Подбираем похожие проекты…</p>
      </div>
    );
  }
  if (error || !report) {
    return (
      <div className="card p-5">
        {header}
        <p className="text-sm text-rose-600">{error ?? 'Не удалось загрузить'}</p>
      </div>
    );
  }

  // Сервер раскрыл названия только сотрудникам — гость видит обезличенные ярлыки.
  const reveal = !compact && report.neighbours.some((n) => n.customer !== null);
  const delta =
    report.calibratedHours !== null ? report.calibratedHours - report.target.currentHours : null;

  return (
    <div className="card p-5">
      {header}

      <p className="mb-4 text-xs text-slate-600 dark:text-nord-4">{report.confidenceNote}</p>

      {report.neighbours.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-nord-muted">
          Утверждённых расчётов этого шаблона: {report.poolSize}. Как только появятся проекты с
          похожими ответами, здесь будет ориентир по часам, срокам и рискам.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              title="Формула шаблона"
              value={`${report.target.formulaHours} ч`}
              hint={`сейчас в расчёте ${report.target.currentHours} ч (${fmtRatio(report.target.currentRatio)})`}
            />
            <Stat
              title="Типичная поправка"
              value={fmtPct(report.medianRatio)}
              hint={
                report.ratioRange
                  ? `медиана ${fmtRatio(report.medianRatio)}, разброс ${fmtRatio(report.ratioRange.min)}…${fmtRatio(report.ratioRange.max)}`
                  : undefined
              }
              tone={ratioTone(report.medianRatio)}
            />
            <Stat
              title="Калиброванная оценка"
              value={report.calibratedHours !== null ? `${report.calibratedHours} ч` : '—'}
              hint={
                report.calibratedRange
                  ? `коридор ${report.calibratedRange.min}…${report.calibratedRange.max} ч`
                  : undefined
              }
              tone={
                delta !== null && Math.abs(delta) > report.target.currentHours * 0.1
                  ? 'text-amber-700 dark:text-nord-yellow'
                  : undefined
              }
            />
            {report.medianRealRatio !== null && (
              <Stat
                title="Факт у похожих"
                value={fmtPct(report.medianRealRatio)}
                hint={`факт / утверждено, ${report.realSamples} проект(а) с фактом`}
                tone={ratioTone(report.medianRealRatio)}
              />
            )}
            <Stat
              title="Срок у похожих"
              value={report.medianDurationDays !== null ? `${report.medianDurationDays} дн.` : '—'}
              hint={
                report.medianRiskShare !== null
                  ? `риски ≈ ${Math.round(report.medianRiskShare * 100)}% итога`
                  : undefined
              }
            />
          </div>

          {delta !== null && Math.abs(delta) > report.target.currentHours * 0.1 && (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-nord-yellow/30 dark:bg-nord-yellow/10 dark:text-nord-yellow">
              {delta > 0
                ? `На похожих проектах итог оказывался выше формулы: по их опыту расчёт стоит заложить примерно на ${Math.round(delta)} ч больше текущего.`
                : `Похожие проекты утверждались ниже текущей оценки примерно на ${Math.round(-delta)} ч — возможно, есть запас для переговоров.`}
            </p>
          )}

          {report.stageAdjustments.length > 0 && (
            <div className="mt-5">
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-nord-muted">
                Какие этапы обычно правит архитектор
              </h3>
              <div className="overflow-x-auto rounded-lg border border-slate-100 dark:border-nord-3">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500 dark:bg-nord-1/40 dark:text-nord-muted">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Этап</th>
                      <th className="px-3 py-2 text-right font-semibold">Формула</th>
                      <th className="px-3 py-2 text-right font-semibold">Поправка</th>
                      <th className="px-3 py-2 text-right font-semibold">Ориентир</th>
                      <th className="px-3 py-2 text-right font-semibold">Проектов</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-nord-3">
                    {report.stageAdjustments.map((s) => (
                      <tr key={s.name}>
                        <td className="px-3 py-2 text-slate-800 dark:text-nord-5">{s.name}</td>
                        <td className="px-3 py-2 text-right text-slate-600 dark:text-nord-4">
                          {s.targetFormulaHours} ч
                        </td>
                        <td
                          className={`px-3 py-2 text-right font-semibold ${ratioTone(s.medianRatio)}`}
                        >
                          {fmtPct(s.medianRatio)}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-slate-900 dark:text-nord-6">
                          {s.suggestedHours} ч
                        </td>
                        {/* Охват виден всегда: медиана по части соседей и по всем
                            им — разной надёжности, и это не должно быть скрыто. */}
                        <td className="px-3 py-2 text-right text-slate-500 dark:text-nord-muted">
                          <span
                            className={
                              s.samples < report.neighbours.length
                                ? 'text-amber-700 dark:text-nord-yellow'
                                : ''
                            }
                          >
                            {s.samples}
                          </span>
                          <span className="text-slate-400 dark:text-nord-muted">
                            {' '}
                            из {report.neighbours.length}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="mt-5">
            <h3 className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-nord-muted">
              Похожие утверждённые проекты
            </h3>
            <ul className="divide-y divide-slate-100 dark:divide-nord-3">
              {report.neighbours.map((n) => (
                <NeighbourRow key={n.id} n={n} reveal={reveal} />
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
