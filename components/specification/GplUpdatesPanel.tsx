'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { withShareHeaders } from '@/lib/shareClient';
import type { SavedSpecification, SpecificationSnapshot } from '@/lib/specification/types';
import type {
  GplUpdateField,
  GplUpdatePreview,
  GplUpdateRequest,
  GplUpdateSelection,
  GplCurrencyTotal,
} from '@/lib/specification/gpl-update-types';
import { GPL_UPDATE_FIELDS } from '@/lib/specification/gpl-update-types';

type ImportChoice = {
  id: string;
  filename: string;
  checksum: string;
  revision: number;
  vendorId: string;
  status: string;
  createdAt: string;
};
const fieldNames: Record<GplUpdateField, string> = {
  name: 'Наименование',
  kind: 'Тип',
  unit: 'Единица',
  configuration: 'Характеристики',
  licensing: 'Лицензирование',
  term: 'Условия',
  source: 'Источник',
  unitPrice: 'Цена',
  currency: 'Валюта',
};
const kinds: Record<string, string> = {
  hardware: 'Оборудование',
  software: 'ПО',
  license: 'Лицензия',
  support: 'Поддержка',
  service: 'Услуга',
  other: 'Другое',
};
function fieldText(field: GplUpdateField, value: string | null) {
  return value === null
    ? 'Неизвестно'
    : field === 'kind'
      ? kinds[value] || value
      : value || 'Не задано';
}
const canonical = (selections: GplUpdateSelection[]) =>
  selections
    .filter((row) => row.fields.length)
    .map((row) => ({
      ...row,
      fields: GPL_UPDATE_FIELDS.filter((field) => row.fields.includes(field)),
      allowPriceOverride: Boolean(row.allowPriceOverride),
    }))
    .sort((a, b) => a.itemId.localeCompare(b.itemId));
function Totals({ title, totals }: { title: string; totals: GplCurrencyTotal[] }) {
  return (
    <div>
      <h4 className="font-semibold">{title}</h4>
      {totals.length ? (
        totals.map((total) => (
          <p key={total.currency}>
            {total.total} {total.currency} · позиций в сумме: {total.includedCount} · с неизвестной
            ценой или количеством: {total.unknownCount}
          </p>
        ))
      ) : (
        <p>Нет позиций для суммы</p>
      )}
    </div>
  );
}
export default function GplUpdatesPanel({
  calculationId,
  snapshot,
  enabled,
  disabledReason,
  onBusy,
  onApplied,
}: {
  calculationId: string;
  snapshot: SpecificationSnapshot;
  enabled: boolean;
  disabledReason: string;
  onBusy: (busy: boolean) => void;
  onApplied: (saved: SavedSpecification) => void;
}) {
  const [sources, setSources] = useState<ImportChoice[]>([]);
  const cache = useRef<ImportChoice[]>([]);
  const [cursor, setCursor] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [target, setTarget] = useState('');
  const [preview, setPreview] = useState<GplUpdatePreview | null>(null);
  const [selections, setSelections] = useState<GplUpdateSelection[]>([]);
  const [consents, setConsents] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [page, setPage] = useState(0);
  const sequence = useRef(0);
  const context = useRef({ calculationId, version: snapshot.version, enabled });
  context.current = { calculationId, version: snapshot.version, enabled };
  const busyCallback = useRef(onBusy);
  busyCallback.current = onBusy;
  const setWorking = useCallback((value: boolean) => {
    setBusy(value);
    busyCallback.current(value);
  }, []);
  const clear = useCallback(() => {
    sequence.current++;
    setPreview(null);
    setSelections([]);
    setConsents([]);
    setError('');
    setConflict(false);
    setPage(0);
  }, []);
  const load = useCallback(
    async (after = '') => {
      const current = ++sequence.current;
      setWorking(true);
      setError('');
      if (!after) {
        setPreview(null);
        setSelections([]);
        setConsents([]);
        setPage(0);
      }
      try {
        const res = await fetch(
          `/api/catalog/imports${after ? `?cursor=${encodeURIComponent(after)}` : ''}`,
        );
        const data: ImportChoice[] & { error?: string } = await res.json();
        if (!res.ok) throw new Error(data.error || 'Не удалось загрузить GPL');
        if (current !== sequence.current) return;
        const next = after
          ? Array.from(
              new Map([...cache.current, ...data].map((source) => [source.id, source])).values(),
            )
          : data;
        cache.current = next;
        setSources(next);
        setTarget((old) =>
          next.some((source) => source.id === old && source.status === 'confirmed') ? old : '',
        );
        setCursor(data[data.length - 1]?.id || '');
        setHasMore(data.length === 100);
      } catch (e) {
        if (current === sequence.current)
          setError(e instanceof Error ? e.message : 'Ошибка загрузки GPL');
      } finally {
        if (current === sequence.current) setWorking(false);
      }
    },
    [setWorking],
  );
  useEffect(() => {
    clear();
    setWorking(false);
    if (enabled) void load();
    const generation = sequence;
    return () => {
      generation.current++;
      busyCallback.current(false);
    };
  }, [calculationId, snapshot.version, enabled, clear, load, setWorking]);
  const vendorIds = new Set(snapshot.items.map((item) => item.origin?.vendorId).filter(Boolean));
  const choices = sources.filter(
    (source) => source.status === 'confirmed' && vendorIds.has(source.vendorId),
  );
  const endpoint = `/api/calculations/${calculationId}/specification/gpl`;
  async function request(action: 'load' | 'preview' | 'apply') {
    if (!enabled || busy || !target || conflict) return;
    const current = ++sequence.current;
    setWorking(true);
    setError('');
    try {
      const body: GplUpdateRequest | undefined =
        action === 'load'
          ? undefined
          : {
              action,
              version: preview!.version,
              targetImportId: preview!.target.id,
              targetRevision: preview!.target.revision,
              targetChecksum: preview!.target.checksum,
              selections: canonical(selections),
            };
      const res = await fetch(
        action === 'load' ? `${endpoint}?targetImportId=${encodeURIComponent(target)}` : endpoint,
        {
          method: body ? 'POST' : 'GET',
          headers: withShareHeaders(
            calculationId,
            body ? { 'Content-Type': 'application/json' } : {},
          ),
          body: body ? JSON.stringify(body) : undefined,
        },
      );
      const data = await res.json();
      if (
        current !== sequence.current ||
        !context.current.enabled ||
        context.current.calculationId !== calculationId ||
        context.current.version !== snapshot.version
      )
        return;
      if (!res.ok) {
        if (res.status === 409) setConflict(true);
        throw new Error(data.error || 'Не удалось проверить обновление GPL');
      }
      if (action === 'apply') {
        setWorking(false);
        onApplied(data as SavedSpecification);
        clear();
      } else {
        const next = data as GplUpdatePreview;
        if (next.version !== snapshot.version) {
          setConflict(true);
          throw new Error(
            'Спецификация изменена. Загрузите последнюю редакцию перед обновлением GPL.',
          );
        }
        setPreview(next);
        setSelections(canonical(next.selections));
        if (action === 'load')
          setConsents(
            next.selections.filter((row) => row.allowPriceOverride).map((row) => row.itemId),
          );
      }
    } catch (e) {
      if (current === sequence.current)
        setError(e instanceof Error ? e.message : 'Ошибка обновления GPL');
    } finally {
      if (current === sequence.current) setWorking(false);
    }
  }
  function toggle(itemId: string, field: GplUpdateField, checked: boolean) {
    const pricePair = field === 'unitPrice' || field === 'currency';
    const fields: GplUpdateField[] = pricePair ? ['unitPrice', 'currency'] : [field];
    setSelections((old) => {
      const existing = old.find((item) => item.itemId === itemId)?.fields || [];
      const selected = checked
        ? Array.from(new Set([...existing, ...fields]))
        : existing.filter((item) => !fields.includes(item));
      return canonical([
        ...old.filter((item) => item.itemId !== itemId),
        { itemId, fields: selected, allowPriceOverride: consents.includes(itemId) },
      ]);
    });
  }
  const totalsStale =
    !!preview &&
    JSON.stringify(canonical(selections)) !== JSON.stringify(canonical(preview.selections));
  const selectedCount = selections.reduce((total, row) => total + row.fields.length, 0);
  const disabled = !enabled || busy || conflict;
  return (
    <section aria-label="Обновление спецификации из GPL" className="card space-y-4 p-4">
      <h3 className="text-lg font-semibold">Обновление спецификации из GPL</h3>
      <p>
        Выберите подтвержденный GPL и проверьте поля каждой позиции. Применение создаст новую
        черновую редакцию. Количества, ручные строки и прежние редакции сохраняются. Ручная цена
        сохраняется до отдельного согласия на ее замену.
      </p>
      {!enabled && <p role="status">{disabledReason}</p>}
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      {conflict && (
        <p role="status">
          Загрузите последнюю редакцию спецификации и проверьте предложения заново.
        </p>
      )}
      <fieldset disabled={disabled} className="space-y-3">
        <label>
          GPL для обновления проекта
          <select
            className="input w-full"
            value={target}
            onChange={(e) => {
              clear();
              setTarget(e.target.value);
            }}
          >
            <option value="">Выберите подтвержденный GPL связанного вендора</option>
            {choices.map((source) => (
              <option key={source.id} value={source.id}>
                {source.filename} · {source.createdAt} · редакция {source.revision} · SHA-256{' '}
                {source.checksum}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={() => void load()}>
            Обновить GPL проекта
          </button>
          {hasMore && (
            <button className="btn-secondary" onClick={() => void load(cursor)}>
              Загрузить более ранние GPL проекта
            </button>
          )}
          <button
            className="btn-primary"
            disabled={!choices.some((source) => source.id === target)}
            onClick={() => void request('load')}
          >
            Проверить предложения GPL
          </button>
        </div>
      </fieldset>
      {busy && <p role="status">Проверка GPL…</p>}
      {preview && (
        <>
          <p>
            Спецификация: версия {preview.version} · GPL {preview.target.filename}, редакция{' '}
            {preview.target.revision}
          </p>
          <a
            className="text-blue-600 underline"
            href={`/api/catalog/imports/${preview.target.id}/attachment`}
          >
            Исходный GPL проекта
          </a>
          {preview.warnings.length > 0 && (
            <ul>
              {preview.warnings.map((warning, i) => (
                <li key={i}>{warning}</li>
              ))}
            </ul>
          )}
          {preview.rows.slice(page * 20, (page + 1) * 20).map((row) => (
            <fieldset key={row.itemId} disabled={disabled} className="space-y-2 border-t py-3">
              <legend>
                Обновление позиции {snapshot.items.findIndex((item) => item.id === row.itemId) + 1}:{' '}
                {row.name}
              </legend>
              {row.reason && <p>{row.reason}</p>}
              {row.targetSource && (
                <p>
                  Лист {row.targetSource.sheet} · строка {row.targetSource.rowNumber} · SHA-256{' '}
                  {row.targetSource.checksum}
                </p>
              )}
              {row.manualPrice && (
                <label className="flex gap-2">
                  <input
                    type="checkbox"
                    aria-label={`Разрешаю заменить ручную цену: ${row.name}`}
                    checked={consents.includes(row.itemId)}
                    onChange={(e) => {
                      setConsents(
                        e.target.checked
                          ? [...consents, row.itemId]
                          : consents.filter((id) => id !== row.itemId),
                      );
                      setSelections((old) =>
                        canonical(
                          old.map((item) =>
                            item.itemId === row.itemId
                              ? {
                                  ...item,
                                  allowPriceOverride: e.target.checked,
                                  fields: e.target.checked
                                    ? item.fields
                                    : item.fields.filter(
                                        (field) => field !== 'unitPrice' && field !== 'currency',
                                      ),
                                }
                              : item,
                          ),
                        ),
                      );
                    }}
                  />
                  Разрешаю заменить ручную цену и валюту этой позиции
                </label>
              )}
              {row.changes.map((change) => (
                <label key={change.field} className="flex gap-2">
                  <input
                    type="checkbox"
                    aria-label={`Обновить ${fieldNames[change.field]}: ${row.name}`}
                    checked={selections.some(
                      (item) => item.itemId === row.itemId && item.fields.includes(change.field),
                    )}
                    disabled={
                      disabled ||
                      row.status !== 'matched' ||
                      (row.manualPrice &&
                        (change.field === 'unitPrice' || change.field === 'currency') &&
                        !consents.includes(row.itemId))
                    }
                    onChange={(e) => toggle(row.itemId, change.field, e.target.checked)}
                  />
                  <span>
                    {fieldNames[change.field]}: {fieldText(change.field, change.before)} →{' '}
                    {fieldText(change.field, change.after)}
                    {change.manuallyEdited ? ' · изменено вручную' : ''}
                  </span>
                </label>
              ))}
            </fieldset>
          ))}
          {preview.rows.length > 20 && (
            <div className="flex gap-2">
              <button
                className="btn-secondary"
                disabled={page === 0 || busy}
                onClick={() => setPage(page - 1)}
              >
                Предыдущие предложения GPL
              </button>
              <span>
                Страница {page + 1} из {Math.ceil(preview.rows.length / 20)}
              </span>
              <button
                className="btn-secondary"
                disabled={(page + 1) * 20 >= preview.rows.length || busy}
                onClick={() => setPage(page + 1)}
              >
                Следующие предложения GPL
              </button>
            </div>
          )}
          <p>Выбрано полей: {selectedCount}</p>
          {totalsStale ? (
            <p role="status">Выбор изменен. Пересчитайте суммы перед применением.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Totals title="До выбранного обновления" totals={preview.totals.before} />
              <Totals title="После выбранного обновления" totals={preview.totals.after} />
            </div>
          )}
          <p>
            Суммы всей поставки показаны отдельно по валютам с учетом только выбранных изменений.
            Имеющееся оборудование и альтернативы исключены. Неизвестная цена или количество делают
            соответствующую сумму неполной.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-secondary"
              disabled={disabled}
              onClick={() => void request('preview')}
            >
              Пересчитать выбранные изменения GPL
            </button>
            <button
              className="btn-primary"
              disabled={disabled || totalsStale || !selectedCount}
              onClick={() => void request('apply')}
            >
              Применить выбранные поля в новую редакцию
            </button>
          </div>
        </>
      )}
    </section>
  );
}
