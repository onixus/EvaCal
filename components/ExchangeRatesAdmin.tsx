'use client';

import { useCallback, useEffect, useState } from 'react';

interface Rate {
  id: string;
  from: string;
  to: string;
  rate: string;
  date: string;
  source: string;
  createdBy: string;
}

/**
 * Справочник курсов валют (#101 §3). Курс — явная запись «пара, дата, источник»;
 * записи не перезаписываются, новая дата — новая запись. Пересчёт в КП и
 * спецификации выполняется только по сохранённому курсу.
 */
export default function ExchangeRatesAdmin({ canEdit }: { canEdit: boolean }) {
  const [rates, setRates] = useState<Rate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    from: 'USD',
    to: 'RUB',
    rate: '',
    date: new Date().toISOString().slice(0, 10),
    source: '',
  });

  const load = useCallback(async () => {
    const res = await fetch('/api/exchange-rates', { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (res.ok) setRates(data.rates ?? []);
    else setError(data.error ?? 'Не удалось загрузить курсы');
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/exchange-rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, rate: form.rate.trim().replace(',', '.') }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Ошибка');
      setForm({ ...form, rate: '' });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-4 p-5" data-testid="exchange-rates">
      {error && (
        <div className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </div>
      )}
      {canEdit && (
        <div className="flex flex-wrap items-end gap-2 text-sm">
          {(
            [
              ['from', 'Из валюты', 'w-20'],
              ['to', 'В валюту', 'w-20'],
              ['rate', '1 из = ? в', 'w-32'],
              ['date', 'Дата', 'w-40'],
              ['source', 'Источник (ЦБ РФ, договор…)', 'w-64'],
            ] as const
          ).map(([key, label, width]) => (
            <label key={key} className="text-xs">
              {label}
              <input
                type={key === 'date' ? 'date' : 'text'}
                className={`input block ${width} text-sm`}
                value={form[key]}
                maxLength={key === 'from' || key === 'to' ? 3 : undefined}
                onChange={(e) =>
                  setForm({
                    ...form,
                    [key]:
                      key === 'from' || key === 'to'
                        ? e.target.value.toUpperCase()
                        : e.target.value,
                  })
                }
              />
            </label>
          ))}
          <button className="btn-primary text-xs" disabled={busy} onClick={() => void add()}>
            Добавить курс
          </button>
        </div>
      )}
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b text-xs uppercase text-slate-500 dark:border-nord-3">
            <th className="py-1 pr-3">Дата</th>
            <th className="py-1 pr-3">Пара</th>
            <th className="py-1 pr-3 text-right">Курс</th>
            <th className="py-1 pr-3">Источник</th>
            <th className="py-1 pr-3">Внёс</th>
          </tr>
        </thead>
        <tbody>
          {rates.map((r) => (
            <tr key={r.id} className="border-b border-slate-100 dark:border-nord-3">
              <td className="py-1 pr-3 tabular-nums">{r.date}</td>
              <td className="py-1 pr-3">
                1 {r.from} → {r.to}
              </td>
              <td className="py-1 pr-3 text-right tabular-nums">{r.rate}</td>
              <td className="py-1 pr-3">{r.source}</td>
              <td className="py-1 pr-3 text-xs text-slate-500">{r.createdBy}</td>
            </tr>
          ))}
          {rates.length === 0 && (
            <tr>
              <td colSpan={5} className="py-3 text-xs text-slate-500">
                Курсов нет. Без курса пересчёт валют не выполняется — сумма помечается неполной.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
