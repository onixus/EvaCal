'use client';
import { useState } from 'react';
import type { Catalog, Product } from '@/lib/catalog/types';
import { RELATION_LABELS, RELATION_TYPES, type RelationType } from '@/lib/catalog/relations';

const productLabel = (p: Product | undefined, id: string) =>
  p ? `${p.vendor.name} · ${p.name} · ${p.sku}${p.archived ? ' (архив)' : ''}` : id;

/** Relation editor: replacements, alternatives and bundle composition. */
export default function CatalogRelationsPanel({
  catalog,
  busy,
  mutate,
}: {
  catalog: Catalog;
  busy: boolean;
  mutate: (body: unknown, done?: () => void) => Promise<void>;
}) {
  const [type, setType] = useState<RelationType>('replaces');
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [note, setNote] = useState('');
  const byId = new Map(catalog.products.map((p) => [p.id, p]));
  const active = (catalog.relations ?? []).filter((r) => !r.archivedAt);
  const fromOptions = catalog.products.filter(
    (p) => !p.archived && !p.vendor.archived && (type !== 'bundleComponent' || p.kind === 'bundle'),
  );
  // A replaced product may already be archived; other relations need active products.
  const toOptions = catalog.products.filter(
    (p) =>
      p.id !== fromId &&
      (type === 'replaces' || (!p.archived && !p.vendor.archived)) &&
      (type !== 'bundleComponent' || p.kind !== 'bundle'),
  );
  const fromLabel = {
    replaces: 'Новая позиция (замена)',
    alternative: 'Позиция',
    bundleComponent: 'Комплект',
  }[type];
  const toLabel = {
    replaces: 'Заменяемая позиция (может быть в архиве)',
    alternative: 'Альтернатива',
    bundleComponent: 'Компонент',
  }[type];
  return (
    <fieldset disabled={busy} className="card space-y-3 p-4">
      <legend>Связи позиций: замены, альтернативы, состав комплектов</legend>
      <p className="text-sm text-slate-500">
        Связь не меняет проекты: замена в спецификации выполняется явно из проекта и создает новую
        черновую редакцию. Компоненты комплекта в итог не входят — стоимость несет строка комплекта.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          Тип связи
          <select
            className="input w-full"
            value={type}
            onChange={(e) => {
              setType(e.target.value as RelationType);
              setFromId('');
              setToId('');
            }}
          >
            {RELATION_TYPES.map((t) => (
              <option key={t} value={t}>
                {RELATION_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label>
          {fromLabel}
          <select
            className="input w-full"
            value={fromId}
            onChange={(e) => setFromId(e.target.value)}
          >
            <option value="">Выберите позицию</option>
            {fromOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {productLabel(p, p.id)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {toLabel}
          <select className="input w-full" value={toId} onChange={(e) => setToId(e.target.value)}>
            <option value="">Выберите позицию</option>
            {toOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {productLabel(p, p.id)}
              </option>
            ))}
          </select>
        </label>
        {type === 'bundleComponent' && (
          <label>
            Количество на 1 комплект
            <input
              className="input w-full"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </label>
        )}
        <label>
          Комментарий
          <input className="input w-full" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <button
        className="btn-primary"
        disabled={!fromId || !toId}
        onClick={() =>
          mutate(
            {
              action: 'relation.create',
              relation: {
                type,
                fromProductId: fromId,
                toProductId: toId,
                quantity: type === 'bundleComponent' ? quantity.trim() : null,
                note,
              },
            },
            () => {
              setToId('');
              setNote('');
            },
          )
        }
      >
        Сохранить связь
      </button>
      {active.length > 0 && (
        <ul className="space-y-1 text-sm" data-testid="catalog-relations">
          {active.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2">
              <span>
                {r.type === 'replaces'
                  ? `${productLabel(byId.get(r.toProductId), r.toProductId)} заменено на ${productLabel(byId.get(r.fromProductId), r.fromProductId)}`
                  : r.type === 'alternative'
                    ? `${productLabel(byId.get(r.fromProductId), r.fromProductId)} ↔ ${productLabel(byId.get(r.toProductId), r.toProductId)} (альтернативы)`
                    : `Комплект ${productLabel(byId.get(r.fromProductId), r.fromProductId)} включает ${r.quantity} × ${productLabel(byId.get(r.toProductId), r.toProductId)}`}
                {r.note ? ` · ${r.note}` : ''}
              </span>
              <button
                className="btn-secondary"
                onClick={() => {
                  if (window.confirm('Архивировать связь? История сохранится.'))
                    void mutate({ action: 'relation.archive', id: r.id });
                }}
              >
                Архивировать связь
              </button>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}
