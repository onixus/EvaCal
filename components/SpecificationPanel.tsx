'use client';

import { useState, useEffect } from 'react';
import ExchangeRatesEditor from './specification/ExchangeRatesEditor';
import GplUpdatesPanel from './specification/GplUpdatesPanel';
import ReplacementsPanel from './specification/ReplacementsPanel';
import BomImportPanel from './specification/BomImportPanel';
import SpecificationDiffView from './specification/SpecificationDiffView';
import CatalogPicker from './CatalogPicker';
import Link from 'next/link';
import { withShareHeaders } from '@/lib/shareClient';
import type {
  SpecificationSnapshot,
  SpecificationItem,
  SavedSpecification,
} from '@/lib/specification/types';
import { ITEM_KINDS, ITEM_DISPOSITIONS, ITEM_KIND_LABELS } from '@/lib/specification/types';
import { specificationBlockers } from '@/lib/specification/validation';
import { describeTotal, summarizeSpecification } from '@/lib/specification/totals';
import { STATUS_LABELS } from '@/lib/specification/sections';
import { syncBundleComponents } from '@/lib/catalog/relations';
import { evidenceText, itemEvidence } from '@/lib/catalog/compliance';
import { businessDate } from '@/lib/catalog/business-date';
import { newRowId } from '@/lib/rowId';

interface SpecificationPanelProps {
  calculationId: string;
  calculationName: string;
  customerName: string;
  answers: Record<string, unknown>;
  studioHref?: string;
}
const kindLabels = ITEM_KIND_LABELS;
const dispositionLabels = {
  supply: 'Поставляем',
  existing: 'Используем имеющееся',
  alternative: 'Предлагаем альтернативу',
};
const empty = (): SpecificationSnapshot => ({
  version: 0,
  status: 'draft',
  emptySupplyReason: '',
  items: [],
});
const newItem = (): SpecificationItem => ({
  id: newRowId(),
  kind: 'other',
  disposition: 'supply',
  name: '',
  vendor: '',
  sku: '',
  quantity: null,
  unit: 'шт.',
  configuration: '',
  licensing: '',
  term: '',
  source: '',
  rationale: '',
  confirmed: false,
  unitPrice: null,
  currency: 'RUB',
});

function PriceOrigin({ item, canUseCatalog }: { item: SpecificationItem; canUseCatalog: boolean }) {
  if (!item.origin) return null;
  const source = item.origin.fieldSources?.unitPrice || item.origin.import;
  const manual =
    item.priceOverride ||
    item.unitPrice !== item.origin.baseline.unitPrice ||
    item.currency !== item.origin.baseline.currency;
  return (
    <details className="text-sm">
      <summary>Источник цены позиции</summary>
      <p>
        Исходная цена: {item.origin.baseline.unitPrice ?? 'неизвестна'}{' '}
        {item.origin.baseline.currency} ·{' '}
        {manual ? 'Цена или валюта переопределена вручную' : 'Цена из сохраненного источника'}
      </p>
      {source ? (
        <p>
          GPL{' '}
          {canUseCatalog ? (
            <a
              className="text-blue-600 underline"
              href={`/api/catalog/imports/${source.importId}/attachment`}
            >
              {source.importId}
            </a>
          ) : (
            source.importId
          )}{' '}
          · редакция {source.revision} · лист {source.sheet} · строка {source.rowNumber}
        </p>
      ) : (
        <p>
          Каталог {item.origin.productId} · предложение {item.origin.offerId || 'не выбрано'}
        </p>
      )}
    </details>
  );
}

export default function SpecificationPanel({
  calculationId,
  calculationName,
  customerName,
  answers,
  studioHref,
}: SpecificationPanelProps) {
  const [spec, setSpec] = useState<SpecificationSnapshot>(empty);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [canWrite, setCanWrite] = useState(false);
  const [canExport, setCanExport] = useState(false);
  const [canUseCatalog, setCanUseCatalog] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState('');
  const [reload, setReload] = useState(0);
  const [notice, setNotice] = useState('');
  const answersKey = JSON.stringify(answers);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoaded(false);
    setCanWrite(false);
    setCanExport(false);
    setCanUseCatalog(false);
    setError('');
    setDirty(false);
    setSpec(empty());
    const suffix = selectedVersion ? `?version=${selectedVersion}` : '';
    fetch(`/api/calculations/${calculationId}/specification${suffix}`, {
      headers: withShareHeaders(calculationId),
      signal: controller.signal,
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Не удалось загрузить спецификацию');
        if (!controller.signal.aborted) {
          setSpec(data.specification?.snapshot || empty());
          setCanWrite(data.canWrite);
          setCanExport(data.canExport);
          setCanUseCatalog(Boolean(data.canUseCatalog));
          setLoaded(true);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted)
          setError(err instanceof Error ? err.message : 'Ошибка загрузки');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [calculationId, customerName, answersKey, selectedVersion, reload]);

  const change = (next: SpecificationSnapshot) => {
    setSpec({ ...next, status: 'draft' });
    setDirty(true);
    setError('');
  };
  const edit = (id: string, field: keyof SpecificationItem, value: unknown) => {
    const items = spec.items.map((i) =>
      i.id === id
        ? {
            ...i,
            [field]: value,
            ...(field === 'unitPrice' || field === 'currency' ? { priceOverride: true } : {}),
            // A change note documents the edit; it does not alter the confirmed facts.
            confirmed:
              field === 'confirmed'
                ? Boolean(value)
                : field === 'changeReason'
                  ? i.confirmed
                  : false,
          }
        : i,
    );
    // Component quantities follow the bundle: bundles × quantity per bundle.
    change({ ...spec, items: field === 'quantity' ? syncBundleComponents(items, id) : items });
  };
  const reorder = (index: number, offset: number) => {
    const items = [...spec.items];
    const target = index + offset;
    if (target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target], items[index]];
    change({ ...spec, items });
  };
  const save = async (status: SpecificationSnapshot['status']) => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/calculations/${calculationId}/specification`, {
        method: 'POST',
        headers: withShareHeaders(calculationId, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ ...spec, status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Не удалось сохранить');
      setSpec((data as SavedSpecification).snapshot);
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setBusy(false);
    }
  };
  const downloadXlsx = async () => {
    if (!loaded || loading || busy || updateBusy || dirty || !canExport || !spec.version) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(
        `/api/calculations/${calculationId}/specification/xlsx?version=${spec.version}`,
        { headers: withShareHeaders(calculationId) },
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Ошибка выгрузки XLSX');
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `Спецификация_${calculationName.replace(/\s+/g, '_')}_v${spec.version}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка выгрузки XLSX');
    } finally {
      setBusy(false);
    }
  };
  const download = async (draft: boolean) => {
    if (!loaded || loading || busy || updateBusy || dirty || !canExport) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/calculations/${calculationId}/gost34`, {
        method: 'POST',
        headers: withShareHeaders(calculationId, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          docType: 'SPEC',
          draft,
          specificationVersion: spec.version || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || data.error || 'Ошибка экспорта');
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `${draft ? 'Черновик_' : ''}Спецификация_${calculationName.replace(/\s+/g, '_')}_v${spec.version}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка экспорта');
    } finally {
      setBusy(false);
    }
  };
  // Proposes a saved manual row for the shared catalog; the project row is unchanged.
  // «Обновить сведения реестров»: the server re-copies catalog evidence into a new draft.
  const refreshEvidence = async (itemIds?: string[]) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch(`/api/calculations/${calculationId}/specification/evidence`, {
        method: 'POST',
        headers: withShareHeaders(calculationId, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ version: spec.version, ...(itemIds ? { itemIds } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Не удалось обновить сведения реестров');
      setSpec((data as SavedSpecification).snapshot);
      setNotice(
        'Сведения реестров и сертификатов обновлены по каталогу в новой черновой редакции.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка обновления сведений');
    } finally {
      setBusy(false);
    }
  };
  const suggest = async (item: SpecificationItem) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch('/api/catalog/suggestions', {
        method: 'POST',
        headers: withShareHeaders(calculationId, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          action: 'create',
          calculationId,
          version: spec.version,
          itemId: item.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Не удалось предложить позицию');
      setNotice(`«${item.name}» отправлена на рассмотрение в каталог.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка предложения');
    } finally {
      setBusy(false);
    }
  };
  const blockers = specificationBlockers(spec);
  const totals = summarizeSpecification(spec);
  const historical = Boolean(selectedVersion);
  const disabled = !loaded || loading || busy || updateBusy || !canWrite || historical;
  const fields: Array<[keyof SpecificationItem, string]> = [
    ['name', 'Наименование'],
    ['vendor', 'Вендор'],
    ['sku', 'Артикул / редакция'],
    ['quantity', 'Количество (пусто — неизвестно)'],
    ['unit', 'Единица'],
    ['configuration', 'Характеристики'],
    ['licensing', 'Лицензирование / право использования'],
    ['term', 'Срок / условия гарантии и поддержки'],
    ['source', 'Источник'],
    ['rationale', 'Основание количества / выбора'],
    ['unitPrice', 'Цена за единицу (пусто — неизвестно; 0 — бесплатно)'],
    ['currency', 'Валюта'],
    ['purchasePrice', 'Цена закупки за ед. (необязательно)'],
    ['salePrice', 'Цена продажи за ед. в КП (пусто — цена за единицу)'],
    ['discountPercent', 'Скидка строки, %'],
    ['vatRate', 'НДС строки, % (пусто — ставка КП)'],
    ['changeReason', 'Причина изменения в этой редакции'],
  ];

  return (
    <div className="space-y-4">
      <div className="card space-y-3 p-5">
        <h2 className="text-lg font-bold">Спецификация — {customerName}</h2>
        <p className="text-sm text-slate-500">
          Версия {spec.version || 'не сохранена'} ·{' '}
          {dirty ? 'Есть несохраненные изменения' : STATUS_LABELS[spec.status]}. Состав вводится
          вручную или копируется из каталога. Ответы опросника не добавляют товары. Реестры
          автоматически не проверяются.
          {spec.sizingRunIds?.length
            ? ` Позиции связаны с прогонами сайзинга (${spec.sizingRunIds.length}): влияние изменений — во вкладке «Сайзинг».`
            : ''}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label>
            Историческая версия{' '}
            <input
              aria-label="Историческая версия"
              type="number"
              min="1"
              className="input w-24"
              value={selectedVersion}
              disabled={busy || updateBusy || dirty}
              onChange={(e) => setSelectedVersion(e.target.value)}
            />
          </label>
          <button
            className="btn-secondary"
            disabled={busy || updateBusy}
            onClick={() => {
              if (
                dirty &&
                !window.confirm('Загрузить последнюю редакцию и отменить несохраненные изменения?')
              )
                return;
              setDirty(false);
              setSelectedVersion('');
              setReload((n) => n + 1);
            }}
          >
            Загрузить последнюю
          </button>
          <button
            className="btn-secondary"
            disabled={
              !loaded || loading || busy || updateBusy || dirty || !canExport || !spec.version
            }
            onClick={downloadXlsx}
          >
            XLSX редакции
          </button>
          <button
            className="btn-secondary"
            disabled={!loaded || loading || busy || updateBusy || dirty || !canExport}
            onClick={() => download(true)}
          >
            Черновой DOCX
          </button>
          <button
            className="btn-primary"
            disabled={
              !loaded || loading || busy || updateBusy || dirty || blockers.length > 0 || !canExport
            }
            onClick={() => download(false)}
          >
            Выпустить DOCX
          </button>
          {studioHref && (
            <Link className="btn-secondary" href={studioHref}>
              Студия ГОСТ 34
            </Link>
          )}
        </div>
        {error && (
          <p role="alert" className="whitespace-pre-line text-red-600">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm text-green-700">
            {notice}
          </p>
        )}
        {spec.status === 'released' && !dirty && (
          <p className="text-sm text-slate-600">
            Редакция выпущена в комплекте ГОСТ 34 и неизменяема. Любая правка сохраняется новой
            черновой редакцией.
          </p>
        )}
        {!loading && (
          <div className="text-sm" data-testid="specification-totals">
            <p className="font-semibold">Итого по поставляемым позициям</p>
            {totals.length ? (
              <ul className="list-inside list-disc">
                {totals.map((t) => (
                  <li key={t.currency}>{describeTotal(t)}</li>
                ))}
              </ul>
            ) : (
              <p>Поставляемых позиций нет.</p>
            )}
            <p className="text-slate-500">
              Суммы точные, раздельно по валютам; при показе округляются до 0,01 (половина вверх).
              Неизвестная цена не равна нулю: такой итог помечен как неполный.
            </p>
          </div>
        )}
        {loaded && spec.version > 0 && (
          <SpecificationDiffView
            key={`${spec.version}-${selectedVersion}`}
            calculationId={calculationId}
            current={spec}
            disabled={loading || busy || updateBusy || dirty}
          />
        )}
        {loading ? (
          <p>Загрузка…</p>
        ) : (
          blockers.length > 0 && (
            <div className="rounded border border-amber-300 p-3 text-sm">
              <p>Для выпуска требуется:</p>
              <ul className="list-inside list-disc">
                {blockers.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            </div>
          )
        )}
      </div>
      {!loading && (
        <>
          {canUseCatalog && (
            <CatalogPicker
              disabled={disabled}
              onAdd={(items) => change({ ...spec, items: [...spec.items, ...items] })}
            />
          )}
          {canWrite && canUseCatalog && (
            <GplUpdatesPanel
              calculationId={calculationId}
              snapshot={spec}
              enabled={loaded && !loading && !busy && !dirty && !historical && spec.version > 0}
              disabledReason={
                dirty
                  ? 'Сохраните несохраненные изменения перед проверкой GPL.'
                  : historical
                    ? 'Для обновления загрузите последнюю редакцию спецификации.'
                    : 'Сначала сохраните спецификацию.'
              }
              onBusy={setUpdateBusy}
              onApplied={(saved) => {
                setSpec(saved.snapshot);
                setDirty(false);
                setError('');
              }}
            />
          )}
          {canWrite && canUseCatalog && (
            <ReplacementsPanel
              calculationId={calculationId}
              version={spec.version}
              enabled={loaded && !loading && !busy && !dirty && !historical && spec.version > 0}
              onBusy={setUpdateBusy}
              onApplied={(saved) => {
                setSpec(saved.snapshot);
                setDirty(false);
                setError('');
              }}
            />
          )}
          {canWrite && (
            <BomImportPanel
              calculationId={calculationId}
              snapshot={spec}
              enabled={loaded && !loading && !busy && !updateBusy && !dirty && !historical}
              disabledReason={
                dirty
                  ? 'Сохраните несохраненные изменения перед импортом.'
                  : 'Для импорта загрузите последнюю редакцию спецификации.'
              }
              onBusy={setUpdateBusy}
              onSaved={(saved) => {
                setSpec(saved.snapshot);
                setDirty(false);
                setError('');
              }}
            />
          )}
          {spec.items.map((item, index) => (
            <fieldset key={item.id} disabled={disabled} className="card space-y-3 p-5">
              <legend className="font-semibold">Позиция {index + 1}</legend>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <label>
                  Тип
                  <select
                    className="input w-full"
                    aria-label="Тип"
                    value={item.kind}
                    onChange={(e) => edit(item.id, 'kind', e.target.value)}
                  >
                    {ITEM_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {kindLabels[k]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Назначение
                  <select
                    className="input w-full"
                    aria-label="Назначение"
                    value={item.disposition}
                    onChange={(e) => edit(item.id, 'disposition', e.target.value)}
                  >
                    {ITEM_DISPOSITIONS.map((k) => (
                      <option key={k} value={k}>
                        {dispositionLabels[k]}
                      </option>
                    ))}
                  </select>
                </label>
                {fields.map(([key, label]) => (
                  <label key={key} className="text-sm">
                    {label}
                    <input
                      className="input w-full"
                      value={String(item[key] ?? '')}
                      onChange={(e) =>
                        edit(
                          item.id,
                          key,
                          (key === 'quantity' || key === 'unitPrice') && e.target.value === ''
                            ? null
                            : e.target.value,
                        )
                      }
                    />
                  </label>
                ))}
              </div>
              {item.includedIn && (
                <p className="text-sm text-slate-600">
                  В составе комплекта «
                  {spec.items.find((row) => row.id === item.includedIn)?.name || item.includedIn}
                  »: в итог не входит, стоимость несет строка комплекта.
                </p>
              )}
              <PriceOrigin item={item} canUseCatalog={canUseCatalog} />
              {item.origin && (
                <p className="text-sm text-slate-600" data-testid="item-evidence">
                  Реестры / сертификаты:{' '}
                  {evidenceText(itemEvidence(item, businessDate(new Date()) ?? ''))}
                  {item.evidence?.length
                    ? ''
                    : ' (сведения каталога копируются при подтверждении строки или кнопкой «Обновить сведения реестров»)'}
                  {canWrite && !dirty && !historical && spec.version > 0 && (
                    <button
                      className="btn-secondary ml-2"
                      onClick={() => refreshEvidence([item.id])}
                    >
                      Обновить сведения реестров
                    </button>
                  )}
                </p>
              )}
              {item.sizingRef && (
                <p className="text-xs text-slate-500">
                  Сайзинг: метрика {item.sizingRef.metric}
                  {item.sizingRef.scenario ? ` (${item.sizingRef.scenario})` : ''} ={' '}
                  {item.sizingRef.requiredQuantity}
                  {item.sizingRef.unitCapacity
                    ? `, ёмкость единицы ${item.sizingRef.unitCapacity}`
                    : ''}{' '}
                  · проверка влияния — во вкладке «Сайзинг»
                </p>
              )}
              <label className="flex gap-2">
                <input
                  type="checkbox"
                  checked={item.confirmed}
                  onChange={(e) => edit(item.id, 'confirmed', e.target.checked)}
                />
                Подтверждаю сведения и количество этой позиции
              </label>
              <div className="flex gap-2">
                <button
                  className="btn-secondary"
                  onClick={() => {
                    const components = spec.items.filter((i) => i.includedIn === item.id);
                    if (
                      components.length &&
                      !window.confirm(
                        `Удалить комплект вместе с его составом (${components.length} поз.)?`,
                      )
                    )
                      return;
                    change({
                      ...spec,
                      items: spec.items.filter((i) => i.id !== item.id && i.includedIn !== item.id),
                    });
                  }}
                >
                  Удалить
                </button>
                {!item.origin && canWrite && !dirty && !historical && spec.version > 0 && (
                  <button
                    className="btn-secondary"
                    disabled={!item.name}
                    onClick={() => suggest(item)}
                  >
                    Предложить в каталог
                  </button>
                )}
                <button
                  className="btn-secondary"
                  onClick={() =>
                    change({
                      ...spec,
                      items: [...spec.items, { ...item, id: newRowId(), confirmed: false }],
                    })
                  }
                >
                  Копировать
                </button>
                <button
                  aria-label="Переместить выше"
                  className="btn-secondary"
                  disabled={disabled || index === 0}
                  onClick={() => reorder(index, -1)}
                >
                  ↑
                </button>
                <button
                  aria-label="Переместить ниже"
                  className="btn-secondary"
                  disabled={disabled || index === spec.items.length - 1}
                  onClick={() => reorder(index, 1)}
                >
                  ↓
                </button>
              </div>
            </fieldset>
          ))}
          <div className="card space-y-3 p-5">
            {spec.items.length === 0 && (
              <label className="block">
                Если поставка не предусмотрена, укажите причину
                <textarea
                  className="input w-full"
                  disabled={disabled}
                  value={spec.emptySupplyReason}
                  onChange={(e) => change({ ...spec, emptySupplyReason: e.target.value })}
                />
              </label>
            )}
            {spec.items.length > 0 && (
              <ExchangeRatesEditor
                spec={spec}
                disabled={disabled}
                onChange={(exchangeRates) => change({ ...spec, exchangeRates })}
              />
            )}
            <div className="flex flex-wrap gap-2">
              <button
                className="btn-secondary"
                disabled={disabled}
                onClick={() => change({ ...spec, items: [...spec.items, newItem()] })}
              >
                Добавить позицию
              </button>
              <button
                className="btn-secondary"
                disabled={disabled || dirty || !spec.version || !spec.items.some((i) => i.origin)}
                onClick={() => refreshEvidence()}
              >
                Обновить сведения реестров (все позиции каталога)
              </button>
              <button className="btn-secondary" disabled={disabled} onClick={() => save('draft')}>
                Сохранить новую редакцию
              </button>
              <button className="btn-secondary" disabled={disabled} onClick={() => save('review')}>
                Отправить на согласование
              </button>
              <button className="btn-primary" disabled={disabled} onClick={() => save('confirmed')}>
                Подтвердить и сохранить
              </button>
            </div>
            <p className="text-sm text-slate-500">
              Сохранение создает новую неизменяемую редакцию: черновик, на согласовании или
              подтвержденную. Статус «Выпущена» присваивается подтвержденной редакции при выпуске
              комплекта ГОСТ 34. Изменение строки снимает ее подтверждение. Цены сохраняются в
              спецификации; связь с расчетом стоимости КП выполняется отдельно.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
