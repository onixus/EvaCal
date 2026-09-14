'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { roleLabel } from '@/lib/roles';
import type { CapacityCell, CapacityMatrix, CapacitySignal } from '@/lib/capacity';

const SIGNAL_CLS: Record<CapacitySignal, string> = {
  over: 'bg-rose-200 text-rose-900 dark:bg-rose-900/60 dark:text-rose-100',
  high: 'bg-amber-200 text-amber-900 dark:bg-amber-900/60 dark:text-amber-100',
  ok: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100',
  idle: 'bg-slate-100 text-slate-500 dark:bg-nord-1 dark:text-nord-muted',
  unknown: 'bg-white text-slate-600 dark:bg-nord-2 dark:text-nord-4',
};

function fmtWeek(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

export default function CapacityClient({
  initial,
  weeks,
  includeDrafts,
  canWhatIf,
}: {
  initial: CapacityMatrix;
  weeks: number;
  includeDrafts: boolean;
  canWhatIf: boolean;
}) {
  const router = useRouter();
  const [matrix, setMatrix] = useState(initial);
  const [scope, setScope] = useState<'firm' | 'weighted'>('weighted');
  const [roleFilter, setRoleFilter] = useState<string[]>([]);
  const [selected, setSelected] = useState<{ role: string; cell: CapacityCell } | null>(null);
  const [shifts, setShifts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roles = useMemo(
    () =>
      roleFilter.length ? matrix.roles.filter((r) => roleFilter.includes(r.role)) : matrix.roles,
    [matrix, roleFilter],
  );
  const hasShifts = Object.values(shifts).some((v) => v !== 0);

  async function recalc(next: Record<string, number>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/capacity/what-if', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weeks,
          drafts: includeDrafts,
          shifts: Object.entries(next).map(([calculationId, shiftDays]) => ({
            calculationId,
            shiftDays,
          })),
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Ошибка');
      setMatrix(await res.json());
      setSelected(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  }

  function shift(calculationId: string, days: number) {
    const next = { ...shifts, [calculationId]: (shifts[calculationId] ?? 0) + days };
    if (next[calculationId] === 0) delete next[calculationId];
    setShifts(next);
    void recalc(next);
  }

  async function applyShifts() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/capacity/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shifts: Object.entries(shifts).map(([calculationId, shiftDays]) => ({
            calculationId,
            shiftDays,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Ошибка');
      // Применённые сдвиги снимаются с панели; неудавшиеся остаются, чтобы
      // повторное «Применить» не сдвинуло уже записанные расчёты второй раз.
      const applied = new Set<string>(
        (data.applied ?? []).map((a: { calculationId: string }) => a.calculationId),
      );
      const rest = Object.fromEntries(Object.entries(shifts).filter(([id]) => !applied.has(id)));
      setShifts(rest);
      if (data.failed?.length) {
        setError(
          data.failed
            .map((f: { name: string; error: string }) => `${f.name}: ${f.error}`)
            .join('; '),
        );
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  }

  const util = (c: CapacityCell) => (scope === 'firm' ? c.firmUtil : c.weightedUtil);
  const hours = (c: CapacityCell) => (scope === 'firm' ? c.firmHours : c.weightedHours);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div role="group" aria-label="Спрос" className="flex flex-wrap items-center gap-1.5">
          {(['weighted', 'firm'] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={scope === s}
              onClick={() => setScope(s)}
              className={`filter-chip ${scope === s ? 'filter-chip-active' : ''}`}
            >
              {s === 'weighted' ? 'С воронкой' : 'Твёрдый'}
            </button>
          ))}
        </div>
        {matrix.roles.length > 0 && (
          <div role="group" aria-label="Роли" className="flex flex-wrap items-center gap-1.5">
            {matrix.roles.map((r) => {
              const active = roleFilter.includes(r.role);
              return (
                <button
                  key={r.role}
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    setRoleFilter((prev) =>
                      prev.includes(r.role) ? prev.filter((x) => x !== r.role) : [...prev, r.role],
                    )
                  }
                  className={`filter-chip ${active ? 'filter-chip-active' : ''}`}
                >
                  {roleLabel(r.role)}
                  {r.overWeeks > 0 && (
                    <span
                      className={`filter-chip-count ${active ? 'bg-white/20' : 'bg-rose-100 text-rose-700 dark:bg-nord-red/20 dark:text-nord-redText'}`}
                    >
                      !{r.overWeeks}
                    </span>
                  )}
                </button>
              );
            })}
            {roleFilter.length > 0 && (
              <button type="button" className="btn-ghost btn-sm" onClick={() => setRoleFilter([])}>
                Все роли
              </button>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </div>
      )}

      {roles.length === 0 ? (
        <div className="card p-10 text-center text-sm text-slate-500 dark:text-nord-muted">
          В горизонте нет утверждённых или согласуемых расчётов. Ёмкость ролей задаётся в{' '}
          <Link href="/admin/capacity" className="underline">
            админке
          </Link>
          .
        </div>
      ) : (
        <div className="card overflow-x-auto p-3" data-testid="capacity-heatmap">
          <table className="w-full border-separate border-spacing-0.5 text-[11px]">
            <thead>
              <tr>
                <th className="sticky left-0 bg-white px-2 py-1 text-left text-xs font-semibold text-slate-600 dark:bg-nord-2 dark:text-nord-4">
                  Роль
                </th>
                {matrix.weeks.map((w) => (
                  <th
                    key={w}
                    className="px-1 py-1 text-center font-semibold text-slate-500 dark:text-nord-muted"
                  >
                    {fmtWeek(w)}
                  </th>
                ))}
                <th className="px-2 py-1 text-right text-slate-500 dark:text-nord-muted">Σ</th>
              </tr>
            </thead>
            <tbody>
              {roles.map((r) => (
                <tr key={r.role}>
                  <td className="sticky left-0 whitespace-nowrap bg-white px-2 py-1 text-xs font-medium text-slate-800 dark:bg-nord-2 dark:text-nord-5">
                    {roleLabel(r.role)}
                  </td>
                  {r.cells.map((c) => {
                    const u = util(c);
                    const sig = u === null ? 'unknown' : c.signal;
                    return (
                      <td key={c.week} className="p-0">
                        <button
                          onClick={() => setSelected({ role: r.role, cell: c })}
                          className={`h-9 w-full rounded px-1 text-center tabular-nums ${SIGNAL_CLS[sig]} ${selected?.cell === c ? 'ring-2 ring-brand-500' : ''}`}
                          title={`${roleLabel(r.role)} · нед. ${fmtWeek(c.week)}: ${hours(c)} ч${c.capacityHours !== null ? ` из ${c.capacityHours}` : ''}`}
                        >
                          {u === null ? `${hours(c)}ч` : `${Math.round(u * 100)}%`}
                        </button>
                      </td>
                    );
                  })}
                  <td className="px-2 py-1 text-right tabular-nums text-slate-600 dark:text-nord-4">
                    {scope === 'firm' ? r.totalFirm : r.totalWeighted}
                    {r.totalCapacity !== null && (
                      <span className="text-slate-400"> / {r.totalCapacity}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-slate-500 dark:text-nord-muted">
            <span>
              <i className="inline-block h-2.5 w-2.5 rounded bg-rose-300 align-middle" /> &gt; 100%
              перегруз
            </span>
            <span>
              <i className="inline-block h-2.5 w-2.5 rounded bg-amber-300 align-middle" /> 85–100%
              предел
            </span>
            <span>
              <i className="inline-block h-2.5 w-2.5 rounded bg-emerald-200 align-middle" /> норма
            </span>
            <span>
              <i className="inline-block h-2.5 w-2.5 rounded bg-slate-200 align-middle" /> &lt; 40%
              простой
            </span>
            <span>белое — ёмкость роли не задана, показаны часы</span>
          </div>
        </div>
      )}

      {selected && (
        <div className="card p-4 text-xs">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="card-title">
              {roleLabel(selected.role)} · неделя с {fmtWeek(selected.cell.week)}
            </h2>
            <button
              type="button"
              className="btn-ghost btn-sm"
              aria-label="Закрыть"
              onClick={() => setSelected(null)}
            >
              ✕
            </button>
          </div>
          <p className="mb-2 text-slate-500 dark:text-nord-muted">
            Твёрдый спрос {selected.cell.firmHours} ч, с воронкой {selected.cell.weightedHours} ч
            {selected.cell.capacityHours !== null && `, ёмкость ${selected.cell.capacityHours} ч`}.
          </p>
          {selected.cell.items.length === 0 ? (
            <p className="text-slate-500">Расчётов в этой неделе нет.</p>
          ) : (
            <table className="w-full">
              <tbody className="divide-y divide-slate-100 dark:divide-nord-3">
                {selected.cell.items.map((i) => (
                  <tr key={i.calculationId}>
                    <td className="py-1.5">
                      <Link
                        href={`/architect/${i.calculationId}`}
                        className="font-medium underline"
                      >
                        {i.name}
                      </Link>
                      {i.projectName && (
                        <span className="ml-1 text-slate-400">{i.projectName}</span>
                      )}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{i.hours} ч</td>
                    <td className="py-1.5 text-right text-slate-400">×{i.weight}</td>
                    {canWhatIf && (
                      <td className="py-1.5 text-right whitespace-nowrap">
                        <button
                          className="btn-ghost btn-sm"
                          disabled={busy}
                          onClick={() => shift(i.calculationId, -7)}
                          title="На неделю раньше"
                        >
                          ←
                        </button>
                        <span className="mx-1 tabular-nums">
                          {shifts[i.calculationId]
                            ? `${shifts[i.calculationId] > 0 ? '+' : ''}${shifts[i.calculationId] / 7} нед.`
                            : ''}
                        </span>
                        <button
                          className="btn-ghost btn-sm"
                          disabled={busy}
                          onClick={() => shift(i.calculationId, 7)}
                          title="На неделю позже"
                        >
                          →
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {hasShifts && canWhatIf && (
        <div className="card flex flex-wrap items-center justify-between gap-3 border-amber-200 bg-amber-50/40 p-3 text-xs dark:border-nord-yellow/30 dark:bg-nord-yellow/10">
          <span>
            What-if: сдвинуто расчётов — {Object.keys(shifts).length}. Матрица пересчитана без
            записи.
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-ghost"
              disabled={busy}
              onClick={() => {
                setShifts({});
                void recalc({});
              }}
            >
              Сбросить
            </button>
            <button type="button" className="btn-primary" disabled={busy} onClick={applyShifts}>
              Применить сдвиги к датам старта
            </button>
          </div>
        </div>
      )}

      <details className="text-xs text-slate-500 dark:text-nord-muted">
        <summary className="cursor-pointer">Что вошло в спрос ({matrix.included.length})</summary>
        <ul className="mt-1 list-disc pl-5">
          {matrix.included.map((i) => (
            <li key={i.calculationId}>
              {i.name} — вес {i.weight} ({i.reason})
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
