'use client';

import { useState } from 'react';
import type { SpecificationExchangeRate, SpecificationSnapshot } from '@/lib/specification/types';

/**
 * Курсы пересчёта редакции спецификации (#101 §3). Хранятся в снимке с датой и
 * источником; исходные цены строк не меняются. Курс можно подставить из
 * справочника — значение копируется в снимок, и подтверждённая редакция больше
 * от справочника не зависит.
 */
export default function ExchangeRatesEditor({
  spec,
  disabled,
  onChange,
}: {
  spec: SpecificationSnapshot;
  disabled: boolean;
  onChange: (rates: SpecificationExchangeRate[]) => void;
}) {
  const rates = spec.exchangeRates ?? [];
  const currencies = [...new Set(spec.items.map((i) => i.currency).filter(Boolean))].sort();
  const [target, setTarget] = useState('RUB');
  const [message, setMessage] = useState<string | null>(null);
  const missing = currencies.filter(
    (c) => c !== target && !rates.some((r) => r.from === c && r.to === target),
  );

  async function fromRegistry(from: string) {
    setMessage(null);
    const today = new Date().toISOString().slice(0, 10);
    const res = await fetch(`/api/exchange-rates?from=${from}&to=${target}&date=${today}`);
    const data = await res.json().catch(() => ({}));
    const r = data.rates?.[0];
    if (!res.ok || !r) {
      setMessage(`В справочнике нет курса ${from}→${target}: введите курс вручную с источником`);
      return;
    }
    onChange([
      ...rates.filter((x) => !(x.from === from && x.to === target)),
      { from, to: target, rate: r.rate, date: r.date, source: r.source, rateId: r.id },
    ]);
  }

  function update(index: number, patch: Partial<SpecificationExchangeRate>) {
    onChange(rates.map((r, i) => (i === index ? { ...r, ...patch, rateId: undefined } : r)));
  }

  return (
    <div className="space-y-2 text-sm" data-testid="spec-exchange-rates">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Курсы пересчёта в валюту КП</span>
        <input
          className="input w-20 text-xs"
          aria-label="Валюта КП"
          value={target}
          maxLength={3}
          onChange={(e) => setTarget(e.target.value.toUpperCase())}
        />
        {missing.map((c) => (
          <span
            key={c}
            className="flex items-center gap-1 text-xs text-amber-700 dark:text-nord-yellow"
          >
            нет курса {c}→{target}
            <button
              type="button"
              className="btn-ghost text-xs"
              disabled={disabled}
              onClick={() => void fromRegistry(c)}
            >
              из справочника
            </button>
            <button
              type="button"
              className="btn-ghost text-xs"
              disabled={disabled}
              onClick={() =>
                onChange([
                  ...rates,
                  {
                    from: c,
                    to: target,
                    rate: '',
                    date: new Date().toISOString().slice(0, 10),
                    source: '',
                  },
                ])
              }
            >
              вручную
            </button>
          </span>
        ))}
      </div>
      {message && <p className="text-xs text-amber-700 dark:text-nord-yellow">{message}</p>}
      {rates.map((r, i) => (
        <div key={`${r.from}-${r.to}`} className="flex flex-wrap items-center gap-2 text-xs">
          <span>1 {r.from} =</span>
          <input
            className="input w-28 text-xs"
            aria-label={`Курс ${r.from}→${r.to}`}
            disabled={disabled}
            value={r.rate}
            onChange={(e) => update(i, { rate: e.target.value.trim().replace(',', '.') })}
          />
          <span>{r.to} на</span>
          <input
            type="date"
            className="input w-36 text-xs"
            disabled={disabled}
            value={r.date}
            onChange={(e) => update(i, { date: e.target.value })}
          />
          <input
            className="input w-48 text-xs"
            placeholder="источник"
            disabled={disabled}
            value={r.source}
            onChange={(e) => update(i, { source: e.target.value })}
          />
          <button
            type="button"
            className="btn-ghost text-xs"
            disabled={disabled}
            onClick={() => onChange(rates.filter((_, j) => j !== i))}
          >
            Удалить
          </button>
        </div>
      ))}
    </div>
  );
}
