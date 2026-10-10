'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { Catalog } from '@/lib/catalog/types';
import type { SpecificationItem } from '@/lib/specification/types';
import { catalogItem } from '@/lib/catalog/snapshot';
export default function CatalogPicker({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd: (item: SpecificationItem) => void;
}) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [productId, setProductId] = useState('');
  const [offerId, setOfferId] = useState('');
  const product = catalog?.products.find((p) => p.id === productId);
  return (
    <fieldset disabled={disabled || busy} className="card space-y-3 p-4">
      <legend>Добавление из каталога</legend>
      <Link href="/catalog" className="btn-secondary">
        Ведение каталога
      </Link>
      <button
        className="btn-secondary"
        onClick={async () => {
          setBusy(true);
          setError('');
          setProductId('');
          setOfferId('');
          try {
            const res = await fetch('/api/catalog');
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            setCatalog(data);
          } catch (e) {
            setCatalog(null);
            setError(e instanceof Error ? e.message : 'Ошибка каталога');
          } finally {
            setBusy(false);
          }
        }}
      >
        Загрузить каталог
      </button>
      {error && <p role="alert">{error}</p>}
      {catalog && (
        <>
          <label>
            Каталожная позиция
            <select
              className="input w-full"
              value={productId}
              onChange={(e) => {
                setProductId(e.target.value);
                setOfferId('');
              }}
            >
              <option value="">Выберите позицию</option>
              {catalog.products
                .filter((p) => !p.archived && !p.vendor.archived)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.vendor.name} · {p.name} · {p.sku} · {p.edition}
                  </option>
                ))}
            </select>
          </label>
          {product && (
            <label>
              Ценовое предложение
              <select
                className="input w-full"
                value={offerId}
                onChange={(e) => setOfferId(e.target.value)}
              >
                <option value="">Без цены — ввести вручную</option>
                {product.offers
                  .filter(
                    (o) => o.productRevision === product.revision && o.productSnapshot !== null,
                  )
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.unitPrice ?? 'Неизвестно'} {o.currency} · {o.source} · дата{' '}
                      {o.priceDate || 'неизвестна'} · до {o.validUntil || 'неизвестно'} · {o.region}{' '}
                      · {o.terms}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <button
            className="btn-primary"
            disabled={!product}
            onClick={() => {
              if (product)
                onAdd(
                  catalogItem(
                    product,
                    product.offers.find((o) => o.id === offerId),
                  ),
                );
            }}
          >
            Добавить копию в спецификацию
          </button>
          <p className="text-sm text-slate-500">
            Проверьте актуальность предложения, заполните количество и основание выбора. Копия
            допускает ручное изменение цены и характеристик; каталог не изменится.
          </p>
        </>
      )}
    </fieldset>
  );
}
