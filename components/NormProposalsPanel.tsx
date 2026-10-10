'use client';

/**
 * Предложения нормативов этапов шаблона по факту (#103 WP-6c): сформировать,
 * посмотреть объяснение (выборка, полнота, расчёты, выбросы), утвердить или
 * отклонить. Утверждение меняет только этап шаблона.
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CONFIDENCE_LABELS, SKIP_REASON_LABELS } from '@/lib/normProposalLabels';
import type { NormConfidence, NormExplanation, NormSkip } from '@/lib/normProposals';

interface Proposal {
  id: string;
  stageTemplateId: string;
  stageTemplate: { name: string; role: string };
  currentBaseHours: number;
  currentHoursPerUnit: number;
  proposedBaseHours: number;
  proposedHoursPerUnit: number;
  sampleSize: number;
  completeness: number;
  confidence: NormConfidence;
  explanation: NormExplanation;
  status: 'proposed' | 'approved' | 'rejected' | 'superseded';
  createdBy: string | null;
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionComment: string | null;
}

const STATUS_LABELS: Record<Proposal['status'], string> = {
  proposed: 'Ожидает решения',
  approved: 'Утверждено',
  rejected: 'Отклонено',
  superseded: 'Заменено',
};

const SAMPLE_LABELS: Record<string, string> = {
  used: 'учтён',
  outlier: 'выброс',
  'no-actuals': 'нет факта',
  'no-driver': 'нет ответа-драйвера',
  'zero-formula': 'формула 0 ч',
};

const CONFIDENCE_CLASS: Record<NormConfidence, string> = {
  low: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  medium: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
  high: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
};

const pct = (n: number) => `${Math.round(n * 100)}%`;
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleString('ru-RU') : '—');

export default function NormProposalsPanel({ templateId }: { templateId: string }) {
  const router = useRouter();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [skipped, setSkipped] = useState<NormSkip[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});

  const base = `/api/templates/${templateId}/norm-proposals`;

  const load = useCallback(async () => {
    const res = await fetch(base);
    if (res.ok) setProposals((await res.json()).proposals);
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  async function generate() {
    setBusy(true);
    setError(null);
    const res = await fetch(base, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? 'Не удалось сформировать предложения');
    setProposals(data.proposals);
    setSkipped(data.summary.skipped);
  }

  async function decide(p: Proposal, decision: 'approve' | 'reject') {
    setBusy(true);
    setError(null);
    const res = await fetch(`${base}/${p.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, comment: comments[p.id] ?? '' }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? 'Не удалось сохранить решение');
    await load();
    if (decision === 'approve') router.refresh();
  }

  const openProposals = proposals.filter((p) => p.status === 'proposed');
  const history = proposals.filter((p) => p.status !== 'proposed');

  return (
    <div className="card p-6" data-testid="norm-proposals">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-medium">Предложения нормативов по факту</h2>
        <button className="btn-secondary" disabled={busy} onClick={generate}>
          Пересчитать по факту
        </button>
      </div>
      <p className="mb-3 text-xs text-slate-500">
        Сравнивает факт завершённых этапов выигранных проектов с формулой текущего норматива:
        медиана «факт / формула» после отсечения выбросов. Этапы без внесённого факта не считаются
        нулём — они снижают полноту. Малая (меньше 3 наблюдений) или неполная (полнота ниже 70%)
        выборка получает только низкую достоверность. Утверждение меняет норматив для новых
        расчётов; существующие расчёты не пересчитываются.
      </p>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {openProposals.length === 0 && (
        <p className="text-sm text-slate-500">Открытых предложений нет.</p>
      )}
      <div className="space-y-3">
        {openProposals.map((p) => (
          <div key={p.id} className="rounded border border-slate-200 p-3 dark:border-slate-700">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{p.stageTemplate.name}</span>
              <span className="text-xs text-slate-500">{p.stageTemplate.role}</span>
              <span className={`badge ${CONFIDENCE_CLASS[p.confidence]}`}>
                достоверность: {CONFIDENCE_LABELS[p.confidence]}
              </span>
            </div>
            <div className="mt-1 text-sm">
              База: {p.currentBaseHours} → <b>{p.proposedBaseHours}</b> ч; на единицу:{' '}
              {p.currentHoursPerUnit} → <b>{p.proposedHoursPerUnit}</b> ч (×{p.explanation.ratio})
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Наблюдений: {p.sampleSize}; полнота факта: {pct(p.completeness)} (
              {p.explanation.complete} из {p.explanation.considered} завершённых этапов); выбросов:{' '}
              {p.explanation.outliers}; в работе: {p.explanation.inProgress}
            </div>
            {p.explanation.confidenceReasons.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-xs text-slate-500">
                {p.explanation.confidenceReasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
            <button
              className="btn-ghost btn-sm mt-1"
              onClick={() => setOpen(open === p.id ? null : p.id)}
            >
              {open === p.id ? 'Скрыть выборку' : 'Показать выборку'}
            </button>
            {open === p.id && <SampleTable explanation={p.explanation} />}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                className="input min-w-0 flex-1 text-sm"
                placeholder="Комментарий (для отклонения обязателен)"
                value={comments[p.id] ?? ''}
                onChange={(e) => setComments({ ...comments, [p.id]: e.target.value })}
              />
              <button className="btn-primary" disabled={busy} onClick={() => decide(p, 'approve')}>
                Утвердить
              </button>
              <button className="btn-secondary" disabled={busy} onClick={() => decide(p, 'reject')}>
                Отклонить
              </button>
            </div>
          </div>
        ))}
      </div>

      {skipped && skipped.length > 0 && (
        <div className="mt-3 text-xs text-slate-500">
          Без предложения:
          <ul className="list-disc pl-5">
            {skipped.map((s) => (
              <li key={s.stageTemplateId}>
                {s.stageName} — {SKIP_REASON_LABELS[s.reason]}
              </li>
            ))}
          </ul>
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-4">
          <button className="btn-ghost btn-sm" onClick={() => setShowHistory(!showHistory)}>
            {showHistory ? 'Скрыть историю' : `История решений (${history.length})`}
          </button>
          {showHistory && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-slate-500">
                    <th className="py-1 pr-2">Этап</th>
                    <th className="py-1 pr-2">Норматив</th>
                    <th className="py-1 pr-2">Выборка</th>
                    <th className="py-1 pr-2">Статус</th>
                    <th className="py-1 pr-2">Кто / когда</th>
                    <th className="py-1">Комментарий</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((p) => (
                    <tr key={p.id} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="py-1 pr-2">{p.stageTemplate.name}</td>
                      <td className="py-1 pr-2">
                        {p.currentBaseHours}+{p.currentHoursPerUnit}·x → {p.proposedBaseHours}+
                        {p.proposedHoursPerUnit}·x
                      </td>
                      <td className="py-1 pr-2">
                        {p.sampleSize}, {pct(p.completeness)}, {CONFIDENCE_LABELS[p.confidence]}
                      </td>
                      <td className="py-1 pr-2">{STATUS_LABELS[p.status]}</td>
                      <td className="py-1 pr-2">
                        {p.decidedBy ?? '—'} · {fmtDate(p.decidedAt)}
                      </td>
                      <td className="py-1">{p.decisionComment ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SampleTable({ explanation }: { explanation: NormExplanation }) {
  return (
    <div className="mt-2 overflow-x-auto">
      <p className="mb-1 text-xs text-slate-500">
        Метод: медиана «факт / формула»
        {explanation.fences
          ? `, выбросы вне [${explanation.fences.low}; ${explanation.fences.high}]`
          : ', отсечения выбросов нет (меньше 4 наблюдений)'}
        . Итого по учтённым: план {explanation.totals.planHours} ч, формула{' '}
        {explanation.totals.formulaHours} ч, факт {explanation.totals.actualHours} ч.
      </p>
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="text-slate-500">
            <th className="py-1 pr-2">Расчёт</th>
            <th className="py-1 pr-2">Драйвер</th>
            <th className="py-1 pr-2">Формула</th>
            <th className="py-1 pr-2">План</th>
            <th className="py-1 pr-2">Факт</th>
            <th className="py-1 pr-2">Факт / формула</th>
            <th className="py-1">Учёт</th>
          </tr>
        </thead>
        <tbody>
          {explanation.samples.map((s) => (
            <tr key={s.calculationId} className="border-t border-slate-100 dark:border-slate-800">
              <td className="py-1 pr-2">
                <a className="underline" href={`/calculations/${s.calculationId}`}>
                  {s.calculationName}
                </a>{' '}
                v{s.version}
              </td>
              <td className="py-1 pr-2">{s.driverValue ?? '—'}</td>
              <td className="py-1 pr-2">{s.formulaHours}</td>
              <td className="py-1 pr-2">{s.planHours}</td>
              <td className="py-1 pr-2">{s.actualHours ?? 'нет'}</td>
              <td className="py-1 pr-2">{s.ratio ?? '—'}</td>
              <td className="py-1">{SAMPLE_LABELS[s.status] ?? s.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
