'use client';
import { useCallback, useEffect, useState } from 'react';
import { suggestionDrafts, type CatalogSuggestion } from '@/lib/catalog/suggestion-types';
import type { ProductInput, Vendor } from '@/lib/catalog/types';
import { ITEM_KINDS, ITEM_KIND_LABELS } from '@/lib/specification/types';

function Review({
  suggestion,
  vendors,
  busy,
  onReview,
}: {
  suggestion: CatalogSuggestion;
  vendors: Vendor[];
  busy: boolean;
  onReview: (body: unknown) => Promise<void>;
}) {
  const initial = suggestionDrafts(suggestion);
  const [product, setProduct] = useState(initial.product);
  const [withOffer, setWithOffer] = useState(initial.offer !== null);
  const [comment, setComment] = useState('');
  const item = suggestion.itemSnapshot;
  return (
    <div className="space-y-2 border-t py-3" data-testid="catalog-suggestion">
      <p className="font-semibold">
        {item.vendor || 'Вендор не указан'} · {item.name} · {item.sku || 'без артикула'}
      </p>
      <p className="text-sm">
        Проект {suggestion.calculationId}, редакция {suggestion.specificationVersion} · предложил{' '}
        {suggestion.createdBy} · {suggestion.createdAt}
      </p>
      <p className="text-sm">
        {ITEM_KIND_LABELS[item.kind]} · {item.unit} ·{' '}
        {item.configuration || 'характеристики не заданы'} · цена {item.unitPrice ?? 'неизвестна'}{' '}
        {item.currency}
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        <label>
          Вендор каталога
          <select
            className="input w-full"
            value={product.vendorId}
            onChange={(e) => setProduct({ ...product, vendorId: e.target.value })}
          >
            <option value="">Выберите вендора</option>
            {vendors
              .filter((v) => !v.archived)
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Тип позиции для каталога
          <select
            className="input w-full"
            value={product.kind}
            onChange={(e) =>
              setProduct({ ...product, kind: e.target.value as ProductInput['kind'] })
            }
          >
            {ITEM_KINDS.map((k) => (
              <option key={k} value={k}>
                {ITEM_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        {(['name', 'sku', 'edition', 'unit', 'licensing'] as const).map((key) => (
          <label key={key}>
            {
              {
                name: 'Наименование для каталога',
                sku: 'Партномер для каталога',
                edition: 'Редакция для каталога',
                unit: 'Единица для каталога',
                licensing: 'Лицензирование для каталога',
              }[key]
            }
            <input
              className="input w-full"
              value={product[key]}
              onChange={(e) => setProduct({ ...product, [key]: e.target.value })}
            />
          </label>
        ))}
      </div>
      {initial.offer && (
        <label className="flex gap-2 text-sm">
          <input
            type="checkbox"
            checked={withOffer}
            onChange={(e) => setWithOffer(e.target.checked)}
          />
          Создать неподтвержденное ценовое предложение: {initial.offer.unitPrice}{' '}
          {initial.offer.currency}
        </label>
      )}
      <label className="block text-sm">
        Комментарий рецензента
        <input
          className="input w-full"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          className="btn-primary"
          disabled={busy || !product.vendorId || !product.name.trim()}
          onClick={() =>
            onReview({
              action: 'accept',
              id: suggestion.id,
              product,
              offer: withOffer ? initial.offer : null,
              comment,
            })
          }
        >
          Принять в каталог
        </button>
        <button
          className="btn-secondary"
          disabled={busy || !comment.trim()}
          onClick={() => onReview({ action: 'reject', id: suggestion.id, comment })}
        >
          Отклонить
        </button>
      </div>
    </div>
  );
}

/** Review queue of manual project rows proposed for the catalog. */
export default function SuggestionQueue({
  vendors,
  onAccepted,
}: {
  vendors: Vendor[];
  onAccepted: () => Promise<void>;
}) {
  const [suggestions, setSuggestions] = useState<CatalogSuggestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const res = await fetch('/api/catalog/suggestions?status=pending');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    setSuggestions(data.suggestions);
  }, []);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);
  async function review(body: unknown) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/catalog/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await load();
      if (data.status === 'accepted') await onAccepted();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка рассмотрения');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card space-y-2 p-4">
      <h2 className="font-semibold">Предложения в каталог ({suggestions.length})</h2>
      <p className="text-sm text-slate-500">
        Ручные позиции проектов, предложенные для общего каталога. Принятие создает новую позицию
        (и, по выбору, неподтвержденную цену); проектная строка не меняется.
      </p>
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      {!suggestions.length && <p className="text-sm">Нет предложений на рассмотрении.</p>}
      {suggestions.map((s) => (
        <Review key={s.id} suggestion={s} vendors={vendors} busy={busy} onReview={review} />
      ))}
    </section>
  );
}
