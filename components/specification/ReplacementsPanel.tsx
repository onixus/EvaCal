'use client';
import { useCallback, useEffect, useState } from 'react';
import { withShareHeaders } from '@/lib/shareClient';
import type { SavedSpecification } from '@/lib/specification/types';
import type { ReplacementCandidate } from '@/lib/specification/replacements';

/**
 * Rows referencing a catalog product that was replaced. Replacement is explicit: it
 * saves a new draft revision on the server; released revisions stay unchanged.
 */
export default function ReplacementsPanel({
  calculationId,
  version,
  enabled,
  onBusy,
  onApplied,
}: {
  calculationId: string;
  version: number;
  enabled: boolean;
  onBusy: (busy: boolean) => void;
  onApplied: (saved: SavedSpecification) => void;
}) {
  const [candidates, setCandidates] = useState<ReplacementCandidate[]>([]);
  const [choice, setChoice] = useState<Record<string, { relationId: string; offerId: string }>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const res = await fetch(`/api/calculations/${calculationId}/specification/replacements`, {
      headers: withShareHeaders(calculationId),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Не удалось проверить замены');
    setCandidates(data.candidates);
  }, [calculationId]);
  useEffect(() => {
    if (!enabled || !version) return;
    load().catch((e) => setError(e.message));
  }, [enabled, version, load]);
  if (!candidates.length && !error) return null;
  async function apply(candidate: ReplacementCandidate) {
    const selected = choice[candidate.itemId] ?? {
      relationId: candidate.options[0]?.relationId ?? '',
      offerId: '',
    };
    const option = candidate.options.find((o) => o.relationId === selected.relationId);
    if (!option) return;
    if (
      !window.confirm(
        `Заменить «${candidate.itemName}» на ${option.label}? Будет сохранена новая черновая редакция; подтверждение строки снимается.`,
      )
    )
      return;
    setBusy(true);
    onBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/calculations/${calculationId}/specification/replacements`, {
        method: 'POST',
        headers: withShareHeaders(calculationId, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          version,
          itemId: candidate.itemId,
          relationId: selected.relationId,
          offerId: selected.offerId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Не удалось заменить позицию');
      onApplied(data as SavedSpecification);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка замены');
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <section className="card space-y-3 p-4" data-testid="catalog-replacements">
      <h3 className="font-semibold">Замененные позиции каталога</h3>
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      {candidates.map((c) => {
        const selected = choice[c.itemId] ?? {
          relationId: c.options[0]?.relationId ?? '',
          offerId: '',
        };
        const option = c.options.find((o) => o.relationId === selected.relationId);
        return (
          <div key={c.itemId} className="space-y-2 border-t pt-2 text-sm">
            <p>
              «{c.itemName}» ссылается на {c.productLabel}
              {c.productArchived ? ' (в архиве)' : ''}: заменено на{' '}
              {c.options.map((o) => o.label).join('; ')}
            </p>
            {c.options.length > 1 && (
              <select
                className="input w-full"
                aria-label="Замена"
                value={selected.relationId}
                onChange={(e) =>
                  setChoice({ ...choice, [c.itemId]: { relationId: e.target.value, offerId: '' } })
                }
              >
                {c.options.map((o) => (
                  <option key={o.relationId} value={o.relationId}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
            {option && (
              <select
                className="input w-full"
                aria-label="Цена замены"
                value={selected.offerId}
                onChange={(e) =>
                  setChoice({ ...choice, [c.itemId]: { ...selected, offerId: e.target.value } })
                }
              >
                <option value="">Без цены — ввести вручную</option>
                {option.offers.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
            <button
              className="btn-secondary"
              disabled={!enabled || busy || !option || option.archived}
              onClick={() => apply(c)}
            >
              Заменить
            </button>
          </div>
        );
      })}
    </section>
  );
}
