'use client';
import { useState } from 'react';
import { withShareHeaders } from '@/lib/shareClient';
import type { SpecificationSnapshot } from '@/lib/specification/types';
import {
  diffSpecifications,
  DIFF_FIELD_LABELS,
  type DiffItem,
  type SpecificationDiff,
} from '@/lib/specification/diff';
import { STATUS_LABELS } from '@/lib/specification/sections';

const show = (value: string | null) => (value === null ? 'неизвестно' : value || '—');

function ItemLine({ item }: { item: DiffItem }) {
  return (
    <li>
      {item.name || item.id}: {show(item.quantity)} × {show(item.unitPrice)} {item.currency} ={' '}
      {item.bundleComponent ? 'в составе комплекта, в итог не входит' : show(item.amount)}
      {item.changeReason && <span> · причина: {item.changeReason}</span>}
    </li>
  );
}

export function DiffReport({ diff }: { diff: SpecificationDiff }) {
  const empty = !diff.added.length && !diff.removed.length && !diff.changed.length;
  return (
    <div className="space-y-2 text-sm" data-testid="specification-diff">
      <p>
        Редакция {diff.from} ({STATUS_LABELS[diff.status.before]}) → редакция {diff.to} (
        {STATUS_LABELS[diff.status.after]}). Без изменений: {diff.unchangedCount}.
      </p>
      {empty && <p>Состав позиций не изменился.</p>}
      {diff.added.length > 0 && (
        <div>
          <h4 className="font-semibold">Добавлено ({diff.added.length})</h4>
          <ul className="list-inside list-disc">
            {diff.added.map((item) => (
              <ItemLine key={item.id} item={item} />
            ))}
          </ul>
        </div>
      )}
      {diff.removed.length > 0 && (
        <div>
          <h4 className="font-semibold">Удалено ({diff.removed.length})</h4>
          <ul className="list-inside list-disc">
            {diff.removed.map((item) => (
              <ItemLine key={item.id} item={item} />
            ))}
          </ul>
        </div>
      )}
      {diff.changed.length > 0 && (
        <div>
          <h4 className="font-semibold">Изменено ({diff.changed.length})</h4>
          {diff.changed.map((row) => (
            <div key={row.id} className="border-l-2 border-slate-300 pl-2">
              <p className="font-medium">
                {row.name || row.id}
                {row.moved ? ' · порядок изменен' : ''}
              </p>
              {row.changeReason && <p>Причина изменения: {row.changeReason}</p>}
              <ul className="list-inside list-disc">
                {row.changes.map((c) => (
                  <li key={c.field}>
                    {DIFF_FIELD_LABELS[c.field]}: {show(c.before)} → {show(c.after)}
                  </li>
                ))}
                {row.amount && (
                  <li>
                    Сумма строки:{' '}
                    {row.bundleComponent?.before ? 'в составе комплекта' : show(row.amount.before)}{' '}
                    → {row.bundleComponent?.after ? 'в составе комплекта' : show(row.amount.after)}
                  </li>
                )}
              </ul>
            </div>
          ))}
        </div>
      )}
      <div>
        <h4 className="font-semibold">Итоги по валютам</h4>
        {diff.totals.length ? (
          <ul className="list-inside list-disc">
            {diff.totals.map((t) => (
              <li key={t.currency}>
                {t.currency || 'без валюты'}: {t.before?.total ?? '—'} → {t.after?.total ?? '—'}{' '}
                (изменение {t.delta}
                {t.incomplete ? '; неполная сумма — есть неизвестные цены или количества' : ''})
              </li>
            ))}
          </ul>
        ) : (
          <p>Поставляемых позиций нет ни в одной из редакций.</p>
        )}
      </div>
    </div>
  );
}

/** «Сравнить с редакцией N»: loads another saved revision and diffs it with the open one. */
export default function SpecificationDiffView({
  calculationId,
  current,
  disabled,
}: {
  calculationId: string;
  current: SpecificationSnapshot;
  disabled: boolean;
}) {
  const [other, setOther] = useState('');
  const [diff, setDiff] = useState<SpecificationDiff | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const compare = async () => {
    setBusy(true);
    setError('');
    setDiff(null);
    try {
      const res = await fetch(
        `/api/calculations/${calculationId}/specification?version=${encodeURIComponent(other)}`,
        { headers: withShareHeaders(calculationId) },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Редакция не найдена');
      const snapshot = data.specification.snapshot as SpecificationSnapshot;
      setDiff(
        snapshot.version <= current.version
          ? diffSpecifications(snapshot, current)
          : diffSpecifications(current, snapshot),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сравнения');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label>
          Сравнить с редакцией{' '}
          <input
            aria-label="Сравнить с редакцией"
            type="number"
            min="1"
            className="input w-24"
            value={other}
            disabled={disabled || busy}
            onChange={(e) => setOther(e.target.value)}
          />
        </label>
        <button
          className="btn-secondary"
          disabled={disabled || busy || !/^[1-9]\d*$/.test(other)}
          onClick={compare}
        >
          Сравнить
        </button>
        {diff && (
          <button className="btn-secondary" onClick={() => setDiff(null)}>
            Скрыть сравнение
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      {diff && <DiffReport diff={diff} />}
    </div>
  );
}
