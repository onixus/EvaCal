'use client';

import { useState } from 'react';
import { roleLabel, ROLES } from '@/lib/roles';
import type { CapacityMatrix } from '@/lib/capacity';
import type { VariantComparison as Comparison, VariantSummary } from '@/lib/planning';

type ChangeType = 'shift' | 'contractor' | 'team';

interface Draft {
  key: number;
  label: string;
  type: ChangeType;
  calculationId: string;
  shiftDays: number;
  role: string;
  share: number;
  ratePerHour: string;
  headcountDelta: number;
  from: string;
  to: string;
  costPerHour: string;
}

const TYPE_LABEL: Record<ChangeType, string> = {
  shift: 'Сдвиг старта',
  contractor: 'Подрядчик',
  team: 'Изменение команды',
};

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (iso: string, days: number) =>
  new Date(new Date(iso).getTime() + days * 864e5).toISOString().slice(0, 10);
const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('ru-RU', { timeZone: 'UTC' }) : '—';

let seq = 0;

function toChange(v: Draft) {
  if (v.type === 'shift') {
    return { type: 'shift', calculationId: v.calculationId, shiftDays: v.shiftDays };
  }
  if (v.type === 'contractor') {
    return {
      type: 'contractor',
      calculationId: v.calculationId,
      role: v.role,
      share: v.share / 100,
      ratePerHour: v.ratePerHour === '' ? null : Number(v.ratePerHour),
    };
  }
  return {
    type: 'team',
    role: v.role,
    headcountDelta: v.headcountDelta,
    from: v.from,
    to: v.to,
    costPerHour: v.costPerHour === '' ? null : Number(v.costPerHour),
  };
}

/**
 * Сравнение вариантов плана (#103 WP-5e): сдвиг старта, подрядчик, изменение
 * команды. Расчёт — POST /api/capacity/what-if без записи; применить можно
 * только сдвиг старта и только через /api/capacity/apply.
 */
export default function VariantComparison({
  calcs,
  roles,
  weeks,
  includeDrafts,
  onShowMatrix,
  onApplied,
}: {
  calcs: { calculationId: string; name: string }[];
  roles: string[];
  weeks: number;
  includeDrafts: boolean;
  onShowMatrix: (m: CapacityMatrix | null, label: string | null) => void;
  onApplied: () => void;
}) {
  const roleOptions = roles.length
    ? roles
    : ROLES.map((r) => r.value).filter((r) => r !== 'customer');
  const blank = (type: ChangeType): Draft => ({
    key: ++seq,
    label: TYPE_LABEL[type],
    type,
    calculationId: calcs[0]?.calculationId ?? '',
    shiftDays: 14,
    role: roleOptions[0] ?? 'engineer',
    share: 100,
    ratePerHour: '',
    headcountDelta: 1,
    from: today(),
    to: plusDays(today(), 27),
    costPerHour: '',
  });
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [result, setResult] = useState<Comparison | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const update = (key: number, patch: Partial<Draft>) =>
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  const payload = () =>
    drafts.map((d) => ({ id: `v${d.key}`, label: d.label, changes: [toChange(d)] }));

  async function compare() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch('/api/capacity/what-if', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weeks, drafts: includeDrafts, variants: payload() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Ошибка');
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const name = window.prompt('Название сравнения');
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/capacity/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, weeks, drafts: includeDrafts, variants: payload() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Ошибка');
      setInfo(`Сравнение «${data.name}» сохранено. План не изменён.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  }

  async function applyShift(v: VariantSummary) {
    const shifts = v.changes
      .filter((c) => c.type === 'shift')
      .map((c) => ({ calculationId: c.calculationId, shiftDays: c.shiftDays }));
    if (!shifts.length) return;
    if (!window.confirm(`Применить «${v.label}» к датам старта?`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/capacity/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shifts }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Ошибка');
      if (data.failed?.length) {
        throw new Error(
          data.failed
            .map((f: { name: string; error: string }) => `${f.name}: ${f.error}`)
            .join('; '),
        );
      }
      setResult(null);
      setInfo('Сдвиг применён: Гант перестроен по календарю.');
      onApplied();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  }

  const rows = result ? [result.baseline, ...result.variants] : [];

  return (
    <div className="card space-y-3 p-4 text-xs" data-testid="variant-comparison">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="card-title">Сравнение вариантов</h2>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(TYPE_LABEL) as ChangeType[]).map((t) => (
            <button
              key={t}
              type="button"
              className="btn-secondary btn-sm"
              disabled={drafts.length >= 5}
              onClick={() => setDrafts((prev) => [...prev, blank(t)])}
            >
              + {TYPE_LABEL[t]}
            </button>
          ))}
        </div>
      </div>
      <p className="text-slate-500 dark:text-nord-muted">
        Варианты считаются без записи в план. Применить можно только сдвиг старта — через тот же
        механизм, что и what-if по неделям; подрядчик и изменение команды оформляются отдельно
        (ёмкость ролей — в админке).
      </p>

      {drafts.map((v) => (
        <div
          key={v.key}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2 dark:border-nord-3"
        >
          <input
            className="input w-44"
            aria-label="Название варианта"
            value={v.label}
            onChange={(e) => update(v.key, { label: e.target.value })}
          />
          {v.type !== 'team' && (
            <select
              className="input w-56"
              aria-label="Расчёт"
              value={v.calculationId}
              onChange={(e) => update(v.key, { calculationId: e.target.value })}
            >
              {calcs.map((c) => (
                <option key={c.calculationId} value={c.calculationId}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          {v.type === 'shift' && (
            <label className="flex items-center gap-1">
              на
              <input
                type="number"
                className="input w-20"
                value={v.shiftDays}
                onChange={(e) => update(v.key, { shiftDays: e.target.valueAsNumber || 0 })}
              />
              дн.
            </label>
          )}
          {v.type !== 'shift' && (
            <select
              className="input w-40"
              aria-label="Роль"
              value={v.role}
              onChange={(e) => update(v.key, { role: e.target.value })}
            >
              {roleOptions.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </select>
          )}
          {v.type === 'contractor' && (
            <>
              <label className="flex items-center gap-1">
                доля
                <input
                  type="number"
                  min={1}
                  max={100}
                  className="input w-20"
                  value={v.share}
                  onChange={(e) => update(v.key, { share: e.target.valueAsNumber || 0 })}
                />
                %
              </label>
              <label className="flex items-center gap-1">
                ставка
                <input
                  type="number"
                  min={0}
                  className="input w-24"
                  placeholder="за час"
                  value={v.ratePerHour}
                  onChange={(e) => update(v.key, { ratePerHour: e.target.value })}
                />
              </label>
            </>
          )}
          {v.type === 'team' && (
            <>
              <label className="flex items-center gap-1">
                ±
                <input
                  type="number"
                  className="input w-16"
                  value={v.headcountDelta}
                  onChange={(e) => update(v.key, { headcountDelta: e.target.valueAsNumber || 0 })}
                />
                чел.
              </label>
              <input
                type="date"
                className="input w-36"
                aria-label="С"
                value={v.from}
                onChange={(e) => update(v.key, { from: e.target.value })}
              />
              <input
                type="date"
                className="input w-36"
                aria-label="По"
                value={v.to}
                onChange={(e) => update(v.key, { to: e.target.value })}
              />
              <label className="flex items-center gap-1">
                стоимость часа
                <input
                  type="number"
                  min={0}
                  className="input w-24"
                  value={v.costPerHour}
                  onChange={(e) => update(v.key, { costPerHour: e.target.value })}
                />
              </label>
            </>
          )}
          <button
            type="button"
            className="btn-ghost btn-sm ml-auto text-rose-600"
            aria-label="Убрать вариант"
            onClick={() => setDrafts((prev) => prev.filter((d) => d.key !== v.key))}
          >
            ✕
          </button>
        </div>
      ))}

      {drafts.length > 0 && (
        <div className="flex gap-2">
          <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={compare}>
            Сравнить
          </button>
          <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={save}>
            Сохранить сравнение
          </button>
        </div>
      )}
      {error && <p className="text-rose-600">{error}</p>}
      {info && <p className="text-emerald-700 dark:text-emerald-300">{info}</p>}

      {result && (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="text-slate-500 dark:text-nord-muted">
              <tr>
                <th className="py-1 pr-3">Вариант</th>
                <th className="py-1 pr-3">Окончание</th>
                <th className="py-1 pr-3 text-right">Недель перегруза</th>
                <th className="py-1 pr-3 text-right">Пик загрузки</th>
                <th className="py-1 pr-3 text-right">Δ стоимости</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-nord-3">
              {rows.map((v) => (
                <tr key={v.id}>
                  <td className="py-1.5 pr-3 font-medium">{v.label}</td>
                  <td className="py-1.5 pr-3">
                    {v.ends.length === 0
                      ? '—'
                      : v.ends.map((e) => (
                          <div key={e.calculationId}>
                            {e.name}: {fmt(e.endDate)}
                            {e.deltaDays ? (
                              <span
                                className={e.deltaDays > 0 ? 'text-rose-600' : 'text-emerald-600'}
                              >
                                {' '}
                                ({e.deltaDays > 0 ? '+' : ''}
                                {e.deltaDays} дн.)
                              </span>
                            ) : null}
                          </div>
                        ))}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">
                    {v.overWeeks}
                    {Object.keys(v.overWeeksByRole).length > 0 && (
                      <div className="text-[10px] text-slate-400">
                        {Object.entries(v.overWeeksByRole)
                          .map(([r, n]) => `${roleLabel(r)} ${n}`)
                          .join(', ')}
                      </div>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">
                    {Math.round(v.peakUtil * 100)}%
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">
                    {v.costDelta === null
                      ? '—'
                      : `${v.costDelta > 0 ? '+' : ''}${v.costDelta.toLocaleString('ru-RU')}`}
                  </td>
                  <td className="py-1.5 text-right whitespace-nowrap">
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      onClick={() =>
                        onShowMatrix(
                          v.id === 'baseline' ? null : v.matrix,
                          v.id === 'baseline' ? null : v.label,
                        )
                      }
                    >
                      На карте
                    </button>
                    {v.changes.some((c) => c.type === 'shift') && (
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        disabled={busy}
                        onClick={() => applyShift(v)}
                      >
                        Применить сдвиг
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
