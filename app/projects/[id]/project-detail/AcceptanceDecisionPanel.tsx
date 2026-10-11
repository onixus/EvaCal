'use client';

import { useMemo, useState } from 'react';
import {
  DECISION_KIND_LABELS,
  decisionInputs,
  isOutstanding,
  type DecisionKind,
} from '@/lib/acceptance/decision';
import type { DecisionState, SerializedCheck } from '@/lib/acceptance/types';

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

async function readError(res: Response): Promise<string> {
  const data = await res.json().catch(() => null);
  return data?.error || `Ошибка ${res.status}`;
}

/**
 * Решение приёмочной комиссии по редакции. Решение не выбирается заранее;
 * «принять» доступно, только если все проверки пройдены без замечаний и
 * пересмотра; «принять с замечаниями» требует описать каждую такую проверку.
 * Окончательную проверку правил делает сервер.
 */
export default function AcceptanceDecisionPanel({
  pkgId,
  checks,
  state,
  canRecord,
  onSaved,
}: {
  pkgId: string;
  checks: SerializedCheck[];
  state: DecisionState;
  canRecord: boolean;
  onSaved: () => void;
}) {
  const outstanding = useMemo(() => decisionInputs(checks).filter(isOutstanding), [checks]);
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState<DecisionKind | ''>('');
  const [members, setMembers] = useState([{ name: '', position: '', organization: '' }]);
  const [basis, setBasis] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!decision) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/gost34/packages/${pkgId}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision,
          commission: members.filter((m) => m.name.trim()),
          basis,
          exceptions:
            decision === 'accepted_with_remarks'
              ? outstanding.map((c) => ({ checkId: c.id, note: notes[c.id] ?? '' }))
              : [],
        }),
      });
      if (!res.ok) throw new Error(await readError(res));
      setOpen(false);
      setDecision('');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const current = state.current;
  return (
    <div className="rounded-md border border-slate-200 p-3 text-xs dark:border-nord-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1">
          <div className="font-semibold text-slate-900 dark:text-nord-6">Решение комиссии</div>
          {current ? (
            <div className="text-slate-700 dark:text-nord-4">
              <strong>{DECISION_KIND_LABELS[current.decision]}</strong> · {fmt(current.decidedAt)} ·
              записал {current.decidedBy}. Основание: {current.basis}
              <div className="text-slate-500 dark:text-nord-muted">
                Комиссия: {current.commission.map((m) => m.name).join(', ')}
              </div>
              {current.exceptions.length > 0 && (
                <ul className="list-disc pl-5">
                  {current.exceptions.map((e) => (
                    <li key={e.checkId}>
                      {e.requirementCode}: {e.note}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : state.stale ? (
            <div className="font-semibold text-amber-700 dark:text-amber-300">
              Решение устарело: после него записаны новые результаты. В акт и протокол выводы не
              попадут, пока комиссия не вынесет решение заново.
            </div>
          ) : (
            <div className="text-slate-500 dark:text-nord-muted">
              Решение не записано — в акте и протоколе выводы останутся пустыми строками.
            </div>
          )}
        </div>
        {canRecord && checks.length > 0 && (
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? 'Отмена' : 'Записать решение'}
          </button>
        )}
      </div>

      {open && (
        <form onSubmit={submit} className="mt-3 space-y-2">
          <label className="flex items-center gap-1.5">
            Решение*:
            <select
              value={decision}
              onChange={(e) => setDecision(e.target.value as DecisionKind | '')}
              className="input py-1 text-xs"
              required
            >
              <option value="" disabled>
                — выберите —
              </option>
              <option value="accepted" disabled={outstanding.length > 0}>
                {DECISION_KIND_LABELS.accepted}
                {outstanding.length > 0 ? ' (есть непройденные проверки)' : ''}
              </option>
              <option value="accepted_with_remarks" disabled={outstanding.length === 0}>
                {DECISION_KIND_LABELS.accepted_with_remarks}
              </option>
              <option value="rejected">{DECISION_KIND_LABELS.rejected}</option>
            </select>
          </label>
          <div className="space-y-1">
            <div>Состав комиссии*:</div>
            {members.map((m, i) => (
              <div key={i} className="flex flex-wrap gap-1">
                {(['name', 'position', 'organization'] as const).map((field) => (
                  <input
                    key={field}
                    value={m[field]}
                    onChange={(e) =>
                      setMembers((prev) =>
                        prev.map((p, j) => (j === i ? { ...p, [field]: e.target.value } : p)),
                      )
                    }
                    placeholder={
                      field === 'name' ? 'ФИО*' : field === 'position' ? 'Должность' : 'Организация'
                    }
                    className="input flex-1 py-1 text-xs"
                  />
                ))}
              </div>
            ))}
            <button
              type="button"
              className="underline"
              onClick={() =>
                setMembers((prev) => [...prev, { name: '', position: '', organization: '' }])
              }
            >
              + член комиссии
            </button>
          </div>
          <textarea
            value={basis}
            onChange={(e) => setBasis(e.target.value)}
            placeholder="Основание* (протокол заседания, номер и дата)"
            rows={2}
            className="input w-full text-xs"
          />
          {decision === 'accepted_with_remarks' && (
            <div className="space-y-1">
              <div>Замечания по каждой непройденной или требующей пересмотра проверке*:</div>
              {outstanding.map((c) => (
                <label key={c.id} className="flex items-center gap-2">
                  <span className="w-24 shrink-0 font-mono">{c.requirementCode}</span>
                  <input
                    value={notes[c.id] ?? ''}
                    onChange={(e) => setNotes((prev) => ({ ...prev, [c.id]: e.target.value }))}
                    placeholder="Что устранить и в какой срок"
                    className="input flex-1 py-1 text-xs"
                  />
                </label>
              ))}
            </div>
          )}
          {error && <p className="text-rose-600 dark:text-rose-400">{error}</p>}
          <button type="submit" disabled={busy || !decision} className="btn-primary text-xs">
            {busy ? 'Сохранение…' : 'Записать решение'}
          </button>
        </form>
      )}

      {state.history.length > 1 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-slate-500 dark:text-nord-muted">
            История решений ({state.history.length})
          </summary>
          <ol className="mt-1 space-y-0.5">
            {state.history.map((d) => (
              <li key={d.id}>
                {fmt(d.decidedAt)} — {DECISION_KIND_LABELS[d.decision]} ({d.decidedBy})
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
