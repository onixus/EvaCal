'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ROLES, roleLabel } from '@/lib/roles';
import PageHeader from '@/components/PageHeader';

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
    <div className="page">
      <PageHeader
        title="Ёмкость ролей"
        description={
          <>
            Сколько ставок каждой роли и с какой даты. Ресурсный план делит спрос из Гантов на эту
            ёмкость.{' '}
            <Link href="/capacity" className="underline">
              Открыть план
            </Link>
          </>
        }
        actions={
          <Link href="/admin" className="btn-secondary">
            ← Админка
          </Link>
        }
      />

      <form onSubmit={submit} className="card grid gap-3 p-4 sm:grid-cols-6">
        <div>
          <label className="label">Роль</label>
          <select
            className="input"
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
          <label className="label">Ставок</label>
          <input
            type="number"
            min={0}
            step="0.5"
            className="input"
            value={form.headcount}
            onChange={(e) => setForm({ ...form, headcount: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Часов/нед. на ставку</label>
          <input
            type="number"
            min={1}
            max={80}
            className="input"
            value={form.hoursPerWeek}
            onChange={(e) => setForm({ ...form, hoursPerWeek: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Действует с</label>
          <input
            type="date"
            className="input"
            value={form.effectiveFrom}
            onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Заметка</label>
          <input
            className="input"
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />
        </div>
        <div className="flex items-end">
          <button type="submit" className="btn-primary w-full" disabled={busy}>
            Добавить
          </button>
        </div>
        {error && <div className="sm:col-span-6 text-xs text-rose-700">{error}</div>}
      </form>

      <div className="card overflow-hidden">
        {rows.length === 0 ? (
          <p className="p-4 text-xs text-slate-500 dark:text-nord-muted">
            Ёмкость ещё не задана: на плане будут только часы спроса.
          </p>
        ) : (
          <table className="table-list">
            <thead>
              <tr>
                <th>Роль</th>
                <th className="text-right">Ставок</th>
                <th className="text-right">Ч/нед.</th>
                <th className="text-right">Ёмкость</th>
                <th>С</th>
                <th>Заметка</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-medium">{roleLabel(r.role)}</td>
                  <td className="nums text-right">{r.headcount}</td>
                  <td className="nums text-right">{r.hoursPerWeek}</td>
                  <td className="nums text-right">
                    {Math.round(r.headcount * r.hoursPerWeek * 10) / 10} ч
                  </td>
                  <td className="nums">{new Date(r.effectiveFrom).toLocaleDateString('ru-RU')}</td>
                  <td className="text-xs text-slate-500 dark:text-nord-muted">{r.note ?? ''}</td>
                  <td className="text-right">
                    <button
                      className="btn-ghost btn-sm"
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
