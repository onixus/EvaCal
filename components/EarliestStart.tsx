'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { roleLabel } from '@/lib/roles';

interface Result {
  startDate: string | null;
  endDate: string | null;
  shiftDays: number | null;
  checkedDays: number;
  conflictAtFrom: { role: string; week: string; demand: number; capacity: number } | null;
}

const fmt = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { timeZone: 'UTC' });

/**
 * Подбор ближайшей даты старта по ёмкости ролей (#103 WP-5e). Перенос
 * выполняется через /api/capacity/apply — Гант перестраивается по календарю.
 */
export default function EarliestStart({
  calculationId,
  canApply,
}: {
  calculationId: string;
  canApply: boolean;
}) {
  const router = useRouter();
  const [from, setFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function find() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/calculations/${calculationId}/earliest-start?from=${encodeURIComponent(from)}`,
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Ошибка');
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  }

  async function applyShift() {
    if (!result?.shiftDays) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/capacity/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shifts: [{ calculationId, shiftDays: result.shiftDays }] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Ошибка');
      if (data.failed?.length) throw new Error(data.failed[0].error);
      setResult(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="earliest-start">
      <span className="font-medium">Ближайшая доступная дата старта не раньше</span>
      <input
        type="date"
        className="input w-40"
        value={from}
        onChange={(e) => setFrom(e.target.value)}
      />
      <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={find}>
        Подобрать
      </button>
      {result && (
        <span className="basis-full text-slate-600 dark:text-nord-4">
          {result.startDate ? (
            <>
              Старт {fmt(result.startDate)}, окончание {result.endDate && fmt(result.endDate)}
              {result.shiftDays
                ? ` (сдвиг ${result.shiftDays > 0 ? '+' : ''}${result.shiftDays} дн.)`
                : ''}
              .
            </>
          ) : (
            <>В горизонте ({result.checkedDays} раб. дн.) нагрузка не помещается в ёмкость.</>
          )}
          {result.conflictAtFrom && (
            <>
              {' '}
              На выбранную дату мешает: {roleLabel(result.conflictAtFrom.role)}, неделя с{' '}
              {fmt(result.conflictAtFrom.week)} — {result.conflictAtFrom.demand} ч при ёмкости{' '}
              {result.conflictAtFrom.capacity} ч.
            </>
          )}
          {canApply && result.startDate && result.shiftDays ? (
            <button
              type="button"
              className="btn-primary btn-sm ml-2"
              disabled={busy}
              onClick={applyShift}
            >
              Перенести старт
            </button>
          ) : null}
        </span>
      )}
      {error && <span className="basis-full text-rose-600">{error}</span>}
    </div>
  );
}
