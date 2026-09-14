'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ROLES, roleLabel } from '@/lib/roles';

interface Row {
  id: string;
  role: string;
  headcount: number;
  hoursPerWeek: number;
  effectiveFrom: string;
  note: string | null;
}

/** Ёмкость ролей (E2): строки с датой начала действия, история не правится. */
export default function CapacityAdmin({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [form, setForm] = useState({
    role: 'engineer',
    headcount: '1',
    hoursPerWeek: '30',
    effectiveFrom: new Date().toISOString().slice(0, 10),
    note: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/capacity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          headcount: Number(form.headcount),
          hoursPerWeek: Number(form.hoursPerWeek),
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Ошибка');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('Удалить строку ёмкости?')) return;
    setBusy(true);
    try {
      await fetch(`/api/admin/capacity?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Ёмкость ролей</h1>
          <p className="text-sm text-slate-500">
            Сколько ставок каждой роли и с какой даты. Ресурсный план делит спрос из Гантов на эту
            ёмкость.{' '}
            <Link href="/capacity" className="underline">
              Открыть план
            </Link>
          </p>
        </div>
        <Link href="/admin" className="btn-secondary">
          ← Админка
        </Link>
      </div>

      <form onSubmit={submit} className="card grid gap-3 p-5 sm:grid-cols-6">
        <div>
          <label className="label text-xs">Роль</label>
          <select
            className="input text-sm"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
          >
            {ROLES.filter((r) => r.value !== 'customer').map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label text-xs">Ставок</label>
          <input
            type="number"
            min={0}
            step="0.5"
            className="input text-sm"
            value={form.headcount}
            onChange={(e) => setForm({ ...form, headcount: e.target.value })}
          />
        </div>
        <div>
          <label className="label text-xs">Часов/нед. на ставку</label>
          <input
            type="number"
            min={1}
            max={80}
            className="input text-sm"
            value={form.hoursPerWeek}
            onChange={(e) => setForm({ ...form, hoursPerWeek: e.target.value })}
          />
        </div>
        <div>
          <label className="label text-xs">Действует с</label>
          <input
            type="date"
            className="input text-sm"
            value={form.effectiveFrom}
            onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
          />
        </div>
        <div>
          <label className="label text-xs">Заметка</label>
          <input
            className="input text-sm"
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />
        </div>
        <div className="flex items-end">
          <button type="submit" className="btn-primary w-full text-sm" disabled={busy}>
            Добавить
          </button>
        </div>
        {error && <div className="sm:col-span-6 text-xs text-rose-700">{error}</div>}
      </form>

      <div className="card p-5">
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500">
            Ёмкость ещё не задана: на плане будут только часы спроса.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="py-2 pr-4">Роль</th>
                <th className="py-2 pr-4 text-right">Ставок</th>
                <th className="py-2 pr-4 text-right">Ч/нед.</th>
                <th className="py-2 pr-4 text-right">Ёмкость</th>
                <th className="py-2 pr-4">С</th>
                <th className="py-2 pr-4">Заметка</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-nord-3">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="py-2 pr-4 font-medium">{roleLabel(r.role)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{r.headcount}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{r.hoursPerWeek}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {Math.round(r.headcount * r.hoursPerWeek * 10) / 10} ч
                  </td>
                  <td className="py-2 pr-4 tabular-nums">
                    {new Date(r.effectiveFrom).toLocaleDateString('ru-RU')}
                  </td>
                  <td className="py-2 pr-4 text-xs text-slate-500">{r.note ?? ''}</td>
                  <td className="py-2 text-right">
                    <button
                      className="btn-ghost text-xs"
                      disabled={busy}
                      onClick={() => remove(r.id)}
                    >
                      Удалить
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
