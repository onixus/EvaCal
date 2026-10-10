'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface DependencyRow {
  fromStageId: string;
  toStageId: string;
  lagDays: number;
}

interface StageOption {
  id: string;
  name: string;
  isApprovalTask: boolean;
}

/**
 * Редактор явных зависимостей этапов (#103 WP-5e): «этап начинается после
 * окончания (и согласования) другого этапа + пауза в рабочих днях». Этап с
 * зависимостями выходит из неявной цепочки «после предыдущего». Цикл или
 * зависимость «назад» по списку сервер отклоняет.
 */
export default function StageDependencyEditor({
  calculationId,
  stages,
  initial,
  locked,
}: {
  calculationId: string;
  stages: StageOption[];
  initial: DependencyRow[];
  locked: boolean;
}) {
  const router = useRouter();
  const primary = stages.filter((s) => !s.isApprovalTask);
  const [rows, setRows] = useState<DependencyRow[]>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const nameOf = (id: string) => primary.find((s) => s.id === id)?.name ?? '—';

  function update(i: number, patch: Partial<DependencyRow>) {
    setSaved(false);
    setRows((prev) => prev.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  }

  function add() {
    if (primary.length < 2) return;
    setSaved(false);
    setRows((prev) => [
      ...prev,
      { fromStageId: primary[0].id, toStageId: primary[primary.length - 1].id, lagDays: 0 },
    ]);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/calculations/${calculationId}/dependencies`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dependencies: rows.map((r) => ({ ...r, type: 'FS', lagDays: Number(r.lagDays) || 0 })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Не удалось сохранить зависимости');
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 text-xs" data-testid="stage-dependencies">
      <p className="text-slate-500 dark:text-nord-muted">
        Зависимость «окончание → начало»: этап стартует после завершения предшественника вместе с
        его согласованием, плюс пауза в рабочих днях по производственному календарю. Этап с
        зависимостями не ждёт остальных предыдущих этапов. Зависеть можно только от этапов выше по
        списку.
      </p>
      {rows.length === 0 && (
        <p className="text-slate-500">Явных зависимостей нет — этапы идут по порядку списка.</p>
      )}
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <select
            className="input w-56"
            aria-label="Предшественник"
            disabled={locked}
            value={r.fromStageId}
            onChange={(e) => update(i, { fromStageId: e.target.value })}
          >
            {primary.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <span>→</span>
          <select
            className="input w-56"
            aria-label="Зависимый этап"
            disabled={locked}
            value={r.toStageId}
            onChange={(e) => update(i, { toStageId: e.target.value })}
          >
            {primary.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1">
            пауза
            <input
              type="number"
              min={0}
              max={365}
              className="input w-20"
              disabled={locked}
              value={r.lagDays}
              onChange={(e) => update(i, { lagDays: e.target.valueAsNumber || 0 })}
            />
            раб. дн.
          </label>
          {!locked && (
            <button
              type="button"
              className="btn-ghost btn-sm text-rose-600"
              title={`Убрать «${nameOf(r.fromStageId)}» → «${nameOf(r.toStageId)}»`}
              onClick={() => {
                setSaved(false);
                setRows((prev) => prev.filter((_, k) => k !== i));
              }}
            >
              ✕
            </button>
          )}
        </div>
      ))}
      {error && <p className="text-rose-600">{error}</p>}
      {!locked && (
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={primary.length < 2}
            onClick={add}
          >
            + Зависимость
          </button>
          <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={save}>
            {busy ? 'Сохранение…' : 'Сохранить и пересчитать Гант'}
          </button>
          {saved && <span className="self-center text-emerald-600">Сохранено</span>}
        </div>
      )}
    </div>
  );
}
