'use client';
import { useEffect, useState } from 'react';
import type { Catalog, Product, ProductInput, OfferInput, Vendor } from '@/lib/catalog/types';
import { ITEM_KINDS } from '@/lib/specification/types';
const blankProduct = (): ProductInput => ({
  vendorId: '',
  name: '',
  sku: '',
  edition: '',
  kind: 'other',
  unit: 'шт.',
  licensing: '',
  attributes: [],
});
const blankOffer = (): OfferInput => ({
  source: '',
  unitPrice: null,
  currency: 'RUB',
  region: '',
  terms: '',
  priceDate: null,
  validUntil: null,
});
export default function CatalogPanel() {
  const [catalog, setCatalog] = useState<Catalog>({ vendors: [], products: [] });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [vendorName, setVendorName] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [vendorEditing, setVendorEditing] = useState<Vendor | null>(null);
  const [product, setProduct] = useState<ProductInput>(blankProduct);
  const [editing, setEditing] = useState<Product | null>(null);
  const [offer, setOffer] = useState<OfferInput>(blankOffer);
  const [offerProductId, setOfferProductId] = useState('');
  const [offerRevision, setOfferRevision] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  async function load() {
    const res = await fetch('/api/catalog');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    setCatalog(data);
  }
  useEffect(() => {
    load()
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  }, []);
  async function mutate(body: unknown, done?: () => void) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      done?.();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сохранения');
    } finally {
      setBusy(false);
    }
  }
  const vendor = vendorEditing;
  const offerProduct = catalog.products.find((p) => p.id === offerProductId);
  const fields: Array<[keyof Omit<ProductInput, 'attributes' | 'kind'>, string]> = [
    ['name', 'Наименование'],
    ['sku', 'Партномер'],
    ['edition', 'Редакция / вариант поставки'],
    ['unit', 'Единица'],
    ['licensing', 'Лицензирование'],
  ];
  const offerFields: Array<[keyof OfferInput, string]> = [
    ['source', 'Источник цены'],
    ['unitPrice', 'Цена за единицу: пусто — неизвестно'],
    ['currency', 'Валюта'],
    ['region', 'Регион'],
    ['terms', 'Условия / срок поставки'],
    ['priceDate', 'Дата цены'],
    ['validUntil', 'Действует до'],
  ];
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Технические позиции и ценовые предложения ведутся отдельно. Новая цена сохраняется отдельным
        предложением. Архивирование сохраняет историю. Проект получает копию только после явного
        выбора.
      </p>
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      <button
        className="btn-secondary"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          load()
            .then(() => setError(''))
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      >
        Обновить каталог
      </button>
      <fieldset disabled={busy} className="card space-y-3 p-4">
        <legend>Вендоры</legend>
        <label>
          Вендор для редактирования
          <select
            className="input w-full"
            value={vendorId}
            onChange={(e) => {
              setVendorId(e.target.value);
              setVendorEditing(catalog.vendors.find((v) => v.id === e.target.value) || null);
              setVendorName(catalog.vendors.find((v) => v.id === e.target.value)?.name || '');
            }}
          >
            <option value="">Новый вендор</option>
            {catalog.vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.archived ? ' (архив)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          Название вендора
          <input
            className="input w-full"
            value={vendorName}
            onChange={(e) => setVendorName(e.target.value)}
          />
        </label>
        <button
          className="btn-primary"
          disabled={!vendorName.trim()}
          onClick={() =>
            mutate(
              {
                action: vendor ? 'vendor.update' : 'vendor.create',
                id: vendorId,
                revision: vendor?.revision,
                name: vendorName,
              },
              () => {
                setVendorId('');
                setVendorEditing(null);
                setVendorName('');
              },
            )
          }
        >
          Сохранить вендора
        </button>
        {vendor && !vendor.archived && (
          <button
            className="btn-secondary"
            onClick={() => {
              if (window.confirm('Архивировать вендора и исключить его позиции из нового подбора?'))
                mutate({ action: 'vendor.archive', id: vendor.id, revision: vendor.revision });
            }}
          >
            Архивировать вендора
          </button>
        )}
      </fieldset>
      <fieldset disabled={busy} className="card space-y-3 p-4">
        <legend>
          {editing ? `Редактирование: ${editing.name} (ред. ${editing.revision})` : 'Новая позиция'}
        </legend>
        <label>
          Вендор позиции
          <select
            className="input w-full"
            value={product.vendorId}
            onChange={(e) => setProduct({ ...product, vendorId: e.target.value })}
          >
            <option value="">Выберите вендора</option>
            {catalog.vendors
              .filter((v) => !v.archived)
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Тип позиции
          <select
            className="input w-full"
            value={product.kind}
            onChange={(e) =>
              setProduct({ ...product, kind: e.target.value as ProductInput['kind'] })
            }
          >
            {ITEM_KINDS.map((k, i) => (
              <option key={k} value={k}>
                {['Оборудование', 'ПО', 'Лицензия', 'Поддержка', 'Услуга', 'Другое'][i]}
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          {fields.map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                className="input w-full"
                value={product[key]}
                onChange={(e) => setProduct({ ...product, [key]: e.target.value })}
              />
            </label>
          ))}
        </div>
        <p>Характеристики (название, значение, единица)</p>
        {product.attributes.map((a, i) => (
          <div className="flex flex-wrap gap-2" key={i}>
            {(['name', 'value', 'unit'] as const).map((key, j) => (
              <input
                key={key}
                aria-label={`${['Название характеристики', 'Значение характеристики', 'Единица характеристики'][j]} ${i + 1}`}
                className="input"
                value={a[key]}
                onChange={(e) =>
                  setProduct({
                    ...product,
                    attributes: product.attributes.map((old, n) =>
                      n === i ? { ...old, [key]: e.target.value } : old,
                    ),
                  })
                }
              />
            ))}
            <button
              className="btn-secondary"
              onClick={() =>
                setProduct({ ...product, attributes: product.attributes.filter((_, n) => n !== i) })
              }
            >
              Удалить характеристику
            </button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <button
            className="btn-secondary"
            onClick={() =>
              setProduct({
                ...product,
                attributes: [...product.attributes, { name: '', value: '', unit: '' }],
              })
            }
          >
            Добавить характеристику
          </button>
          <button
            className="btn-primary"
            disabled={!product.vendorId || !product.name.trim()}
            onClick={() =>
              mutate(
                {
                  action: editing ? 'product.update' : 'product.create',
                  id: editing?.id,
                  revision: editing?.revision,
                  product,
                },
                () => {
                  setProduct(blankProduct());
                  setEditing(null);
                },
              )
            }
          >
            Сохранить позицию
          </button>
          <button
            className="btn-secondary"
            onClick={() => {
              setEditing(null);
              setProduct(blankProduct());
            }}
          >
            Отменить редактирование
          </button>
        </div>
      </fieldset>
      <fieldset disabled={busy} className="card space-y-3 p-4">
        <legend>Новое ценовое предложение</legend>
        <label>
          Позиция для цены
          <select
            className="input w-full"
            value={offerProductId}
            onChange={(e) => {
              setOfferProductId(e.target.value);
              setOfferRevision(
                catalog.products.find((p) => p.id === e.target.value)?.revision ?? null,
              );
            }}
          >
            <option value="">Выберите позицию</option>
            {catalog.products
              .filter((p) => !p.archived && !p.vendor.archived)
              .map((p) => (
                <option value={p.id} key={p.id}>
                  {p.vendor.name} · {p.name} · {p.sku} · {p.edition}
                </option>
              ))}
          </select>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          {offerFields.map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                type={key === 'priceDate' || key === 'validUntil' ? 'date' : 'text'}
                className="input w-full"
                value={offer[key] ?? ''}
                onChange={(e) =>
                  setOffer({
                    ...offer,
                    [key]:
                      e.target.value ||
                      (['unitPrice', 'priceDate', 'validUntil'].includes(key) ? null : ''),
                  })
                }
              />
            </label>
          ))}
        </div>
        <button
          className="btn-primary"
          disabled={!offerProduct || !offer.source.trim()}
          onClick={() =>
            mutate(
              {
                action: 'offer.create',
                id: offerProductId,
                revision: offerRevision,
                offer,
              },
              () => setOffer(blankOffer()),
            )
          }
        >
          Сохранить отдельное предложение
        </button>
      </fieldset>
      <label>
        Поиск по вендору, названию, партномеру
        <input className="input w-full" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      {catalog.products
        .filter((p) =>
          `${p.name} ${p.sku} ${p.edition} ${p.vendor.name} ${p.offers.map((o) => (o.productSnapshot ? `${o.productSnapshot.name} ${o.productSnapshot.sku} ${o.productSnapshot.edition} ${o.productSnapshot.vendor.name}` : '')).join(' ')}`
            .toLowerCase()
            .includes(query.toLowerCase()),
        )
        .map((p) => (
          <div key={p.id} className="card space-y-2 p-4">
            <h2 className="font-semibold">
              {p.vendor.name} · {p.name} · {p.sku} · {p.edition}
            </h2>
            <p>
              Редакция {p.revision}
              {p.archived || p.vendor.archived ? ' · Архив' : ''}
            </p>
            <p>{p.attributes.map((a) => `${a.name}: ${a.value} ${a.unit}`).join('; ')}</p>
            {!p.archived && !p.vendor.archived && (
              <div className="flex gap-2">
                <button
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() => {
                    setEditing(p);
                    setProduct({ ...p, attributes: p.attributes.map((a) => ({ ...a })) });
                  }}
                >
                  Редактировать
                </button>
                <button
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm('Архивировать позицию? Проектные копии сохранятся.'))
                      mutate({ action: 'product.archive', id: p.id, revision: p.revision });
                  }}
                >
                  Архивировать
                </button>
              </div>
            )}
            <details>
              <summary>История предложений ({p.offers.length})</summary>
              {p.offers.map((o) => (
                <div key={o.id} className="space-y-1 border-t py-2">
                  {o.productSnapshot ? (
                    <>
                      <p>
                        Цена для: {o.productSnapshot.vendor.name} · {o.productSnapshot.name} ·{' '}
                        {o.productSnapshot.sku} · {o.productSnapshot.edition}
                      </p>
                      <p>
                        {o.productSnapshot.attributes
                          .map((a) => `${a.name}: ${a.value} ${a.unit}`)
                          .join('; ')}{' '}
                        · {o.productSnapshot.licensing} · единица {o.productSnapshot.unit}
                      </p>
                    </>
                  ) : (
                    <p>
                      Исторические характеристики не сохранены. Для нового подбора создайте новое
                      предложение.
                    </p>
                  )}
                  <p>
                    Ред. позиции {o.productRevision} · {o.unitPrice ?? 'Цена неизвестна'}{' '}
                    {o.currency} · {o.source} · {o.region || 'Регион не задан'} · дата цены{' '}
                    {o.priceDate || 'неизвестна'} · действует до {o.validUntil || 'неизвестно'} ·{' '}
                    {o.terms} · добавлено {o.createdAt} · {o.createdBy}
                  </p>
                </div>
              ))}
            </details>
          </div>
        ))}
    </div>
  );
}
