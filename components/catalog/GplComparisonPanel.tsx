'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { productInput, offerInput } from '@/lib/catalog/validation';
import type { Vendor } from '@/lib/catalog/types';
import type { ImportDraft, ImportRow } from '@/lib/catalog/import-types';
import type {
  ComparisonField,
  ComparisonSource,
  ComparisonStatus,
  ImportComparison,
} from '@/lib/catalog/comparison-types';

type SavedImport = Pick<
  ImportDraft,
  'id' | 'filename' | 'checksum' | 'revision' | 'status' | 'createdAt'
> & { vendorId: string };
const statuses: Record<ComparisonStatus, string> = {
  added: 'Добавлены',
  missing: 'Нет среди подтвержденных строк',
  changed: 'Изменены',
  unchanged: 'Без изменений',
  ambiguous: 'Неоднозначные совпадения',
};
const fieldNames: Record<ComparisonField, string> = {
  name: 'Наименование',
  kind: 'Тип',
  unit: 'Единица',
  licensing: 'Лицензирование',
  attributes: 'Характеристики',
  unitPrice: 'Цена',
  currency: 'Валюта',
  region: 'Регион',
  terms: 'Условия',
  priceDate: 'Дата цены',
  validUntil: 'Действует до',
};
const kindNames: Record<string, string> = {
  hardware: 'Оборудование',
  software: 'ПО',
  license: 'Лицензия',
  support: 'Поддержка',
  service: 'Услуга',
  other: 'Другое',
};
const PAGE_SIZE = 50;
const sourceLabel = (source: SavedImport) =>
  `${source.filename} · ${source.createdAt} · ред. ${source.revision} · SHA-256 ${source.checksum}`;
function fieldValue(field: ComparisonField, value: string | null) {
  if (value === null) return 'неизвестно';
  if (field === 'kind') return kindNames[value] || value;
  if (field === 'attributes') {
    try {
      const attributes = JSON.parse(value) as Array<{ name: string; value: string; unit: string }>;
      return (
        attributes
          .map((attribute) => `${attribute.name}: ${attribute.value} ${attribute.unit}`.trim())
          .join('; ') || 'не заданы'
      );
    } catch {
      return 'Сведения характеристик недоступны';
    }
  }
  return value || 'не задано';
}
function SourceSummary({ source, title }: { source: ComparisonSource; title: string }) {
  return (
    <div className="space-y-1 break-words">
      <h3 className="font-semibold">
        {title}: {source.filename}
      </h3>
      <p>
        Загружен {source.createdAt} · подтвержден {source.confirmedAt || 'дата неизвестна'} ·
        редакция {source.revision}
      </p>
      <p>
        Лист {source.sheet} · заголовок {source.headerRow} · диапазон {source.startRow}–
        {source.endRow ?? 'конец файла'}
      </p>
      <p>
        Подтверждено: {source.acceptedCount}; не выбрано: {source.excludedCount}; с ошибками:{' '}
        {source.errorCount}
      </p>
      <details>
        <summary>Контрольная сумма</summary>
        <code className="break-all">{source.checksum}</code>
      </details>
      <a className="text-blue-600 underline" href={`/api/catalog/imports/${source.id}/attachment`}>
        Исходный файл {source.filename}
      </a>
    </div>
  );
}
function validNormalized(row: ImportRow) {
  try {
    if (!row.normalized) return null;
    return {
      product: productInput(row.normalized.product),
      offer: offerInput(row.normalized.offer),
    };
  } catch {
    return null;
  }
}
function SourceRows({ rows, source }: { rows: ImportRow[]; source: ComparisonSource }) {
  if (!rows.length) return <p>Нет среди подтвержденных строк</p>;
  return (
    <>
      {rows.length > 5 && (
        <p>
          Показаны первые 5 из {rows.length} совпадений. Остальные позиции доступны в исходном
          файле.
        </p>
      )}
      {rows.slice(0, 5).map((row) => {
        const normalized = validNormalized(row);
        return (
          <div key={row.id} className="space-y-1 border-b py-2">
            <p>{normalized?.product.name || 'Сведения позиции отсутствуют'}</p>
            <p>
              Цена: {normalized?.offer.unitPrice ?? 'неизвестна'} {normalized?.offer.currency}
            </p>
            <p>
              {row.sheet} · строка {row.rowNumber} ·{' '}
              <a
                className="text-blue-600 underline"
                href={`/api/catalog/imports/${source.id}/attachment`}
              >
                {source.filename}
              </a>
            </p>
            {normalized && (
              <details>
                <summary>Характеристики и условия позиции</summary>
                <p>
                  {kindNames[normalized.product.kind] || normalized.product.kind} · единица{' '}
                  {normalized.product.unit} · лицензирование{' '}
                  {normalized.product.licensing || 'не задано'}
                </p>
                <p>
                  {normalized.product.attributes
                    .map((attribute) => `${attribute.name}: ${attribute.value} ${attribute.unit}`)
                    .join('; ') || 'Характеристики не заданы'}
                </p>
                <p>
                  Условия: {normalized.offer.terms || 'не заданы'} · регион{' '}
                  {normalized.offer.region || 'не задан'} · дата цены{' '}
                  {normalized.offer.priceDate || 'неизвестна'} · действует до{' '}
                  {normalized.offer.validUntil || 'неизвестно'}
                </p>
              </details>
            )}
          </div>
        );
      })}
    </>
  );
}
export default function GplComparisonPanel({
  vendors,
  refreshToken = 0,
}: {
  vendors: Vendor[];
  refreshToken?: number;
}) {
  const [sources, setSources] = useState<SavedImport[]>([]);
  const [cursor, setCursor] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [vendorId, setVendorId] = useState('');
  const [before, setBefore] = useState('');
  const [after, setAfter] = useState('');
  const [comparison, setComparison] = useState<ImportComparison | null>(null);
  const [filter, setFilter] = useState<ComparisonStatus | ''>('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const sourceCache = useRef<SavedImport[]>([]);
  function clear() {
    sequence.current++;
    setComparison(null);
    setError('');
    setPage(0);
  }
  const loadSources = useCallback(async (cursorToLoad = '') => {
    const append = !!cursorToLoad;
    const current = ++sequence.current;
    setBusy(true);
    setError('');
    if (!append) setComparison(null);
    try {
      const response = await fetch(
        `/api/catalog/imports${append ? `?cursor=${encodeURIComponent(cursorToLoad)}` : ''}`,
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось загрузить сохраненные GPL');
      if (sequence.current !== current) return;
      const nextPage = data as SavedImport[];
      const combined = append
        ? Array.from(
            new Map(
              [...sourceCache.current, ...nextPage].map((source) => [source.id, source]),
            ).values(),
          )
        : nextPage;
      const confirmed = combined.filter((source) => source.status === 'confirmed');
      sourceCache.current = combined;
      setSources(combined);
      setCursor(nextPage[nextPage.length - 1]?.id || '');
      setHasMore(nextPage.length === 100);
      setBefore((old) => (confirmed.some((source) => source.id === old) ? old : ''));
      setAfter((old) => (confirmed.some((source) => source.id === old) ? old : ''));
    } catch (e) {
      if (sequence.current === current) {
        if (!append) {
          sourceCache.current = [];
          setSources([]);
          setHasMore(false);
          setCursor('');
        }
        setError(e instanceof Error ? e.message : 'Не удалось загрузить GPL');
      }
    } finally {
      if (sequence.current === current) setBusy(false);
    }
  }, []);
  useEffect(() => {
    const counter = sequence;
    void loadSources();
    return () => {
      counter.current++;
    };
  }, [loadSources, refreshToken]);
  async function compare() {
    const current = ++sequence.current;
    setBusy(true);
    setError('');
    setComparison(null);
    setPage(0);
    try {
      const response = await fetch(
        `/api/catalog/imports/compare?${new URLSearchParams({ before, after })}`,
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось сравнить GPL');
      if (sequence.current === current) setComparison(data);
    } catch (e) {
      if (sequence.current === current)
        setError(e instanceof Error ? e.message : 'Ошибка сравнения');
    } finally {
      if (sequence.current === current) setBusy(false);
    }
  }
  const choices = sources.filter(
    (source) => source.status === 'confirmed' && source.vendorId === vendorId,
  );
  const validChoices =
    before &&
    after &&
    before !== after &&
    choices.some((source) => source.id === before) &&
    choices.some((source) => source.id === after);
  const rows = (comparison?.rows || []).filter(
    (row) =>
      (!filter || row.status === filter) &&
      `${row.sku} ${row.edition} ${[...row.before, ...row.after].map((sourceRow) => validNormalized(sourceRow)?.product.name || '').join(' ')}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const lastPage = Math.max(0, Math.ceil(rows.length / PAGE_SIZE) - 1);
  return (
    <section aria-label="Сравнение вендорских GPL" className="card space-y-4 p-4">
      <h2 className="text-lg font-semibold">Сравнение вендорских GPL</h2>
      <p>
        Сравниваются выбранные подтвержденные позиции двух GPL одного вендора. Отсутствие позиции
        среди подтвержденных строк не означает снятие с продажи. Валюты сохраняются в исходном виде;
        проектные спецификации сохраняют выбранные цены.
      </p>
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      <button className="btn-secondary" disabled={busy} onClick={() => void loadSources()}>
        Обновить список GPL
      </button>
      {hasMore && (
        <button className="btn-secondary" disabled={busy} onClick={() => void loadSources(cursor)}>
          Загрузить более ранние GPL
        </button>
      )}
      <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
        <label>
          Вендор для сравнения
          <select
            className="input w-full"
            value={vendorId}
            onChange={(e) => {
              clear();
              setVendorId(e.target.value);
              setBefore('');
              setAfter('');
            }}
          >
            <option value="">Выберите вендора</option>
            {vendors.map((vendor) => (
              <option key={vendor.id} value={vendor.id}>
                {vendor.name}
                {vendor.archived ? ' (архив)' : ''}
              </option>
            ))}
          </select>
        </label>
        {(['before', 'after'] as const).map((side) => (
          <label key={side}>
            {side === 'before' ? 'Исходный GPL' : 'Следующий GPL'}
            <select
              className="input w-full"
              value={side === 'before' ? before : after}
              onChange={(e) => {
                clear();
                (side === 'before' ? setBefore : setAfter)(e.target.value);
              }}
            >
              <option value="">Выберите подтвержденный пакет</option>
              {choices.map((source) => (
                <option key={source.id} value={source.id}>
                  {sourceLabel(source)}
                </option>
              ))}
            </select>
          </label>
        ))}
        <button className="btn-primary" disabled={!validChoices} onClick={() => void compare()}>
          Сравнить выбранные GPL
        </button>
      </fieldset>
      {busy && <p role="status">Загрузка GPL…</p>}
      {comparison && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <SourceSummary source={comparison.before} title="Исходный GPL" />
            <SourceSummary source={comparison.after} title="Следующий GPL" />
          </div>
          {comparison.before.excludedCount +
            comparison.after.excludedCount +
            comparison.before.errorCount +
            comparison.after.errorCount >
            0 && (
            <p role="status">
              Покрытие неполное: невыбранные и ошибочные строки исключены из сравнения. Сверьте
              диапазоны и исходные файлы перед выводами о составе прайса.
            </p>
          )}
          {comparison.warnings.length > 0 && (
            <ul>
              {comparison.warnings.map((warning, i) => (
                <li key={i}>{warning}</li>
              ))}
            </ul>
          )}
          <p>
            {(Object.keys(statuses) as ComparisonStatus[])
              .map((status) => `${statuses[status]}: ${comparison.counts[status]}`)
              .join(' · ')}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              Статус сравнения
              <select
                className="input w-full"
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value as ComparisonStatus | '');
                  setPage(0);
                }}
              >
                <option value="">Все статусы</option>
                {(Object.keys(statuses) as ComparisonStatus[]).map((status) => (
                  <option key={status} value={status}>
                    {statuses[status]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Поиск в сравнении
              <input
                className="input w-full"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
              />
            </label>
          </div>
          <p>
            Найдено позиций: {rows.length} · страница {Math.min(page, lastPage) + 1} из{' '}
            {lastPage + 1}
          </p>
          <div className="flex gap-2">
            <button className="btn-secondary" disabled={!page} onClick={() => setPage(page - 1)}>
              Предыдущая страница сравнения
            </button>
            <button
              className="btn-secondary"
              disabled={page >= lastPage}
              onClick={() => setPage(page + 1)}
            >
              Следующая страница сравнения
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th>Артикул / редакция</th>
                  <th>Статус</th>
                  <th>Исходный GPL</th>
                  <th>Следующий GPL</th>
                  <th>Изменения</th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .slice(
                    Math.min(page, lastPage) * PAGE_SIZE,
                    (Math.min(page, lastPage) + 1) * PAGE_SIZE,
                  )
                  .map((row) => (
                    <tr key={row.key} className="border-t align-top">
                      <td>
                        {row.sku} · {row.edition || 'редакция не задана'}
                      </td>
                      <td>{statuses[row.status]}</td>
                      <td>
                        <SourceRows rows={row.before} source={comparison.before} />
                      </td>
                      <td>
                        <SourceRows rows={row.after} source={comparison.after} />
                      </td>
                      <td>
                        {row.changes.map((change) => (
                          <p key={change.field}>
                            {fieldNames[change.field]}: {fieldValue(change.field, change.before)} →{' '}
                            {fieldValue(change.field, change.after)}
                          </p>
                        ))}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {!rows.length && <p>Позиций для выбранного фильтра нет.</p>}
        </>
      )}
    </section>
  );
}
