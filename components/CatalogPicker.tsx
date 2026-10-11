'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { Catalog } from '@/lib/catalog/types';
import type { SpecificationItem } from '@/lib/specification/types';
import { catalogItem } from '@/lib/catalog/snapshot';
import {
  alternativesOf,
  componentsOf,
  expandBundle,
  replacementsOf,
} from '@/lib/catalog/relations';
export default function CatalogPicker({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd: (items: SpecificationItem[]) => void;
}) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [productId, setProductId] = useState('');
  const [offerId, setOfferId] = useState('');
  const [bundleQuantity, setBundleQuantity] = useState('');
  const product = catalog?.products.find((p) => p.id === productId);
  const relations = catalog?.relations ?? [];
  const byId = new Map((catalog?.products ?? []).map((p) => [p.id, p]));
  const label = (id: string) => {
    const p = byId.get(id);
    return p ? `${p.vendor.name} · ${p.name} · ${p.sku}${p.archived ? ' (архив)' : ''}` : id;
  };
  const replacedBy = product ? replacementsOf(relations, product.id) : [];
  const alternatives = product ? alternativesOf(relations, product.id) : [];
  const components = product ? componentsOf(relations, product.id) : [];
  const add = () => {
    if (!product) return;
    try {
      setError('');
      const row = catalogItem(
        product,
        product.offers.find((o) => o.id === offerId),
      );
      if (product.kind !== 'bundle') return onAdd([row]);
      // Components are copied without prices in the total: the bundle row carries the price.
      const bundle = { ...row, quantity: bundleQuantity.trim() || null };
      onAdd(
        expandBundle(
          bundle,
          components.map((r) => {
            const component = byId.get(r.toProductId);
            if (!component) throw new Error('Компонент комплекта не найден');
            return { item: catalogItem(component), perBundle: r.quantity! };
          }),
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка добавления');
    }
  };
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
                setBundleQuantity('');
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
                      {o.confirmationStatus === 'confirmed'
                        ? 'Цена подтверждена'
                        : 'Цена не подтверждена'}{' '}
                      · {o.unitPrice ?? 'Неизвестно'} {o.currency} · {o.source} · дата{' '}
                      {o.priceDate || 'неизвестна'} · до {o.validUntil || 'неизвестно'} · {o.region}{' '}
                      · {o.terms}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {product && replacedBy.length > 0 && (
            <div role="status" className="rounded-sm border border-amber-300 p-2 text-sm">
              {replacedBy.map((r) => (
                <p key={r.id}>
                  Заменено на {label(r.fromProductId)}
                  {r.note ? ` (${r.note})` : ''}{' '}
                  {byId.get(r.fromProductId) && !byId.get(r.fromProductId)!.archived && (
                    <button
                      className="btn-secondary"
                      onClick={() => {
                        setProductId(r.fromProductId);
                        setOfferId('');
                      }}
                    >
                      Выбрать замену
                    </button>
                  )}
                </p>
              ))}
            </div>
          )}
          {product && alternatives.length > 0 && (
            <p className="text-sm">
              Альтернативы: {alternatives.map((a) => label(a.productId)).join('; ')}
            </p>
          )}
          {product?.kind === 'bundle' && (
            <div className="space-y-2 text-sm" data-testid="bundle-composition">
              <p>
                Состав комплекта:{' '}
                {components.length
                  ? components.map((r) => `${r.quantity} × ${label(r.toProductId)}`).join('; ')
                  : 'компоненты не заданы'}
              </p>
              <label>
                Количество комплектов (пусто — неизвестно)
                <input
                  className="input w-full"
                  value={bundleQuantity}
                  onChange={(e) => setBundleQuantity(e.target.value)}
                />
              </label>
              <p className="text-slate-500">
                Компоненты добавятся строками «в составе комплекта»; в итог входит только строка
                комплекта.
              </p>
            </div>
          )}
          <button className="btn-primary" disabled={!product} onClick={add}>
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
