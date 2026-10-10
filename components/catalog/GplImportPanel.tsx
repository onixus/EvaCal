'use client';
import { useEffect, useState } from 'react';
import { ITEM_KINDS } from '@/lib/specification/types';
import type { ImportDraft, ImportProfile, ImportRow } from '@/lib/catalog/import-types';
import type { Vendor } from '@/lib/catalog/types';

const fields = [
  ['name', 'Наименование'],
  ['sku', 'Партномер'],
  ['edition', 'Редакция'],
  ['unit', 'Единица'],
  ['licensing', 'Лицензирование'],
  ['unitPrice', 'Цена'],
  ['currency', 'Валюта'],
  ['description', 'Описание'],
  ['terms', 'Условия / срок'],
] as const;

export default function GplImportPanel({
  vendors,
  onImported,
}: {
  vendors: Vendor[];
  onImported: () => Promise<void>;
}) {
  const [vendorId, setVendorId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [sheet, setSheet] = useState('');
  const [headerRow, setHeaderRow] = useState('1');
  const [startRow, setStartRow] = useState('2');
  const [endRow, setEndRow] = useState('');
  const [delimiter, setDelimiter] = useState(';');
  const [decimalSeparator, setDecimalSeparator] = useState(',');
  const [currency, setCurrency] = useState('RUB');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [kind, setKind] = useState<ImportProfile['kind']>('hardware');
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  const [latestRevision, setLatestRevision] = useState(1);
  const [historyRevision, setHistoryRevision] = useState('');
  const historical = historyRevision !== '';
  const [selected, setSelected] = useState<string[]>([]);
  const [saved, setSaved] = useState<Array<Pick<ImportDraft, 'id' | 'filename' | 'createdAt'>>>([]);
  const [editing, setEditing] = useState<ImportRow | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch('/api/catalog/imports')
      .then(async (res) => {
        if (res.ok) setSaved(await res.json());
      })
      .catch(() => {});
  }, []);
  function applyProfile(profile: ImportProfile) {
    setVendorId(profile.vendorId);
    setSheet(profile.sheet);
    setHeaderRow(String(profile.headerRow));
    setStartRow(String(profile.startRow));
    setEndRow(profile.endRow === null ? '' : String(profile.endRow));
    setDelimiter(profile.delimiter);
    setDecimalSeparator(profile.decimalSeparator);
    setCurrency(profile.currency);
    setKind(profile.kind);
    setMapping(
      Object.fromEntries(
        Object.entries(profile.mapping).map(([key, value]) => [key, String(value)]),
      ),
    );
  }
  const profile: ImportProfile = {
    vendorId,
    sheet,
    headerRow: Number(headerRow),
    startRow: Number(startRow),
    endRow: endRow ? Number(endRow) : null,
    delimiter: delimiter as ImportProfile['delimiter'],
    decimalSeparator: decimalSeparator as ImportProfile['decimalSeparator'],
    currency,
    kind,
    mapping: Object.fromEntries(
      Object.entries(mapping)
        .filter(([, value]) => value !== '')
        .map(([key, value]) => [key, Number(value)]),
    ),
  };
  const settingsChanged =
    !!draft &&
    (Object.keys(profile) as Array<keyof ImportProfile>).some((key) =>
      key === 'mapping'
        ? fields.some(([field]) => profile.mapping[field] !== draft.profile.mapping[field])
        : profile[key] !== draft.profile[key],
    );
  async function request(url: string, init?: RequestInit): Promise<ImportDraft> {
    const res = await fetch(url, init);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка импорта');
    return data;
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка импорта');
    } finally {
      setBusy(false);
    }
  }
  function accept(next: ImportDraft) {
    setHistoryRevision('');
    setLatestRevision(next.revision);
    applyProfile(next.profile);
    setDraft(next);
    setSelected([]);
    setEditing(null);
  }
  function mutate(body: unknown) {
    if (historical) throw new Error('Историческая редакция: только просмотр');
    return request(`/api/catalog/imports/${draft!.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
  return (
    <section aria-label="Импорт вендорского GPL" className="card space-y-4 p-4">
      <h2 className="text-lg font-semibold">Импорт вендорского GPL</h2>
      <p>
        Загрузите XLSX или CSV, проверьте сопоставление колонок и подтвердите выбранные строки.
        Пустая цена означает неизвестную цену, 0 — бесплатную позицию.
      </p>
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      <label>
        Сохраненные пакеты и профили
        <select
          className="input w-full"
          disabled={busy}
          defaultValue=""
          onChange={(e) => {
            if (!e.target.value) return;
            const id = e.target.value;
            void run(async () => {
              const old = await request(`/api/catalog/imports/${id}`);
              applyProfile(old.profile);
              accept(old);
            });
          }}
        >
          <option value="">
            Выберите пакет для продолжения или повторного использования профиля
          </option>
          {saved.map((old) => (
            <option key={old.id} value={old.id}>
              {old.filename} · {old.createdAt}
            </option>
          ))}
        </select>
      </label>
      <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
        <label>
          Вендор GPL
          <select
            className="input w-full"
            value={vendorId}
            onChange={(e) => setVendorId(e.target.value)}
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
          Файл GPL (XLSX / CSV)
          <input
            type="file"
            accept=".xlsx,.csv"
            className="input w-full"
            onChange={(e) => {
              setFile(e.target.files?.[0] || null);
              setSheet('');
              setSelected([]);
            }}
          />
        </label>
        <label>
          Лист XLSX
          {draft ? (
            <select
              className="input w-full"
              value={sheet}
              onChange={(e) => setSheet(e.target.value)}
            >
              <option value="">Первый лист</option>
              {draft.sheets.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="input w-full"
              value={sheet}
              onChange={(e) => setSheet(e.target.value)}
              placeholder="Первый лист"
            />
          )}
        </label>
        <label>
          Строка заголовков
          <input
            type="number"
            min="1"
            className="input w-full"
            value={headerRow}
            onChange={(e) => setHeaderRow(e.target.value)}
          />
        </label>
        <label>
          Первая строка данных
          <input
            type="number"
            min="1"
            className="input w-full"
            value={startRow}
            onChange={(e) => setStartRow(e.target.value)}
          />
        </label>
        <label>
          Последняя строка данных
          <input
            type="number"
            min="1"
            className="input w-full"
            value={endRow}
            onChange={(e) => setEndRow(e.target.value)}
            placeholder="До конца файла"
          />
        </label>
        <label>
          Разделитель CSV
          <select
            className="input w-full"
            value={delimiter}
            onChange={(e) => setDelimiter(e.target.value)}
          >
            <option value=";">Точка с запятой</option>
            <option value=",">Запятая</option>
            <option value={'\t'}>Табуляция</option>
          </select>
        </label>
        <label>
          Десятичный разделитель
          <select
            className="input w-full"
            value={decimalSeparator}
            onChange={(e) => setDecimalSeparator(e.target.value)}
          >
            <option value=",">Запятая</option>
            <option value=".">Точка</option>
          </select>
        </label>
        <label>
          Валюта по умолчанию
          <input
            className="input w-full"
            maxLength={3}
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          />
        </label>
        <label>
          Тип импортируемых позиций
          <select
            className="input w-full"
            value={kind}
            onChange={(e) => setKind(e.target.value as ImportProfile['kind'])}
          >
            {ITEM_KINDS.map((value, i) => (
              <option key={value} value={value}>
                {['Оборудование', 'ПО', 'Лицензия', 'Поддержка', 'Услуга', 'Другое'][i]}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn-primary"
          disabled={!file || !vendorId}
          onClick={() =>
            void run(async () => {
              const body = new FormData();
              body.set('file', file!);
              body.set('profile', JSON.stringify(profile));
              const next = await request('/api/catalog/imports', { method: 'POST', body });
              applyProfile(next.profile);
              accept(next);
              setSaved((old) => [next, ...old.filter((item) => item.id !== next.id)]);
            })
          }
        >
          Загрузить черновик GPL
        </button>
      </fieldset>
      {draft && (
        <>
          <p>
            Пакет: {draft.filename} · загрузил {draft.createdBy} · {draft.createdAt} · редакция{' '}
            {draft.revision}
          </p>
          <label className="block">
            Редакция пакета GPL
            <select
              className="input w-full"
              disabled={busy}
              value={historyRevision}
              onChange={(e) => {
                const revision = e.target.value;
                void run(async () => {
                  const old = await request(
                    `/api/catalog/imports/${draft.id}${revision ? `?revision=${revision}` : ''}`,
                  );
                  if (!revision) {
                    accept(old);
                    return;
                  }
                  setHistoryRevision(revision);
                  setDraft(old);
                  applyProfile(old.profile);
                  setSelected([]);
                  setEditing(null);
                });
              }}
            >
              <option value="">Текущая редакция ({latestRevision})</option>
              {Array.from({ length: latestRevision }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  Редакция {i + 1}
                </option>
              ))}
            </select>
          </label>
          <a
            className="text-blue-600 underline"
            href={`/api/catalog/imports/${draft.id}/attachment`}
          >
            Скачать исходный файл
          </a>
          <details>
            <summary>Контрольная сумма исходного файла</summary>
            <code className="break-all">{draft.checksum}</code>
          </details>
          {draft.status === 'draft' && !historical && (
            <fieldset disabled={busy} className="space-y-3">
              <legend>Сопоставление колонок</legend>
              <p>
                Выберите исходные колонки. Сопоставление сохраняется с пакетом и доступно для
                следующего файла.
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                {fields.map(([key, label]) => (
                  <label key={key}>
                    Колонка: {label}
                    <select
                      className="input w-full"
                      value={mapping[key] ?? ''}
                      onChange={(e) => {
                        setMapping({ ...mapping, [key]: e.target.value });
                        setSelected([]);
                      }}
                    >
                      <option value="">Не сопоставлять</option>
                      {draft.headers.map((header, i) => (
                        <option key={i} value={i}>
                          {i + 1}: {header || '(без заголовка)'}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <button
                className="btn-secondary"
                onClick={() =>
                  void run(async () =>
                    accept(await mutate({ action: 'analyze', revision: draft.revision, profile })),
                  )
                }
              >
                Применить настройки и проверить строки
              </button>
            </fieldset>
          )}
          {settingsChanged && !historical && (
            <p role="status">
              Настройки изменены. Примените настройки и проверьте строки перед подтверждением.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th>Подтвердить</th>
                  <th>Источник</th>
                  <th>Исходные значения</th>
                  <th>Позиция / цена</th>
                  <th>Проверка</th>
                </tr>
              </thead>
              <tbody>
                {draft.rows.map((row) => (
                  <tr key={row.id} className="border-t align-top">
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Подтверждаю строку ${row.rowNumber}`}
                        disabled={
                          busy ||
                          historical ||
                          draft.status !== 'draft' ||
                          row.status !== 'ready' ||
                          row.errors.length > 0
                        }
                        checked={selected.includes(row.id)}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, row.id]
                              : selected.filter((id) => id !== row.id),
                          )
                        }
                      />
                    </td>
                    <td>
                      {row.sheet} · строка {row.rowNumber}
                    </td>
                    <td>
                      {row.raw.map((value, i) => (
                        <div key={i}>
                          {draft.headers[i] || `Колонка ${i + 1}`}: {value || '(пусто)'}
                        </div>
                      ))}
                    </td>
                    <td>
                      {row.normalized ? (
                        <>
                          {row.normalized.product.name} · {row.normalized.product.sku}
                          <br />
                          {row.normalized.offer.unitPrice ?? 'Цена неизвестна'}{' '}
                          {row.normalized.offer.currency}
                        </>
                      ) : (
                        'Требует исправления'
                      )}
                    </td>
                    <td>
                      {row.errors.length
                        ? row.errors.join('; ')
                        : {
                            ready: 'Готова к подтверждению',
                            accepted: 'Принята',
                            excluded: 'Не выбрана',
                            error: 'Ошибка',
                          }[row.status]}
                      {draft.status === 'draft' && !historical && (
                        <button
                          className="btn-secondary"
                          disabled={busy}
                          onClick={() => {
                            const value = (key: keyof ImportProfile['mapping']) => {
                              const column = draft.profile.mapping[key];
                              return column === undefined ? '' : row.raw[column] || '';
                            };
                            setEditing(
                              structuredClone({
                                ...row,
                                normalized: row.normalized || {
                                  product: {
                                    vendorId: draft.profile.vendorId,
                                    name: value('name'),
                                    sku: value('sku'),
                                    edition: value('edition'),
                                    kind: draft.profile.kind,
                                    unit: value('unit') || 'шт.',
                                    licensing: value('licensing'),
                                    attributes: value('description')
                                      ? [
                                          {
                                            name: 'Описание',
                                            value: value('description'),
                                            unit: '',
                                          },
                                        ]
                                      : [],
                                  },
                                  offer: {
                                    source: draft.filename,
                                    unitPrice: value('unitPrice') || null,
                                    currency: value('currency') || draft.profile.currency,
                                    region: '',
                                    terms: value('terms'),
                                    priceDate: null,
                                    validUntil: null,
                                  },
                                },
                              }),
                            );
                            setSelected([]);
                          }}
                        >
                          Исправить строку {row.rowNumber}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {editing?.normalized && (
            <fieldset disabled={busy} className="space-y-3">
              <legend>Исправление строки {editing.rowNumber}</legend>
              {(['name', 'sku', 'unit', 'edition', 'licensing'] as const).map((key, i) => (
                <label className="block" key={key}>
                  {
                    [
                      'Исправленное наименование',
                      'Исправленный партномер',
                      'Исправленная единица',
                      'Исправленная редакция',
                      'Исправленное лицензирование',
                    ][i]
                  }
                  <input
                    className="input w-full"
                    value={editing.normalized!.product[key]}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        normalized: {
                          ...editing.normalized!,
                          product: { ...editing.normalized!.product, [key]: e.target.value },
                        },
                      })
                    }
                  />
                </label>
              ))}
              <label className="block">
                Исправленная цена (пусто — неизвестно)
                <input
                  className="input w-full"
                  value={editing.normalized.offer.unitPrice ?? ''}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      normalized: {
                        ...editing.normalized!,
                        offer: { ...editing.normalized!.offer, unitPrice: e.target.value || null },
                      },
                    })
                  }
                />
              </label>
              <label className="block">
                Исправленная валюта
                <input
                  className="input w-full"
                  value={editing.normalized.offer.currency}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      normalized: {
                        ...editing.normalized!,
                        offer: { ...editing.normalized!.offer, currency: e.target.value },
                      },
                    })
                  }
                />
              </label>
              <label className="block">
                Исправленные условия
                <input
                  className="input w-full"
                  value={editing.normalized.offer.terms}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      normalized: {
                        ...editing.normalized!,
                        offer: { ...editing.normalized!.offer, terms: e.target.value },
                      },
                    })
                  }
                />
              </label>
              <label className="block">
                Исправленное описание
                <input
                  className="input w-full"
                  value={
                    editing.normalized.product.attributes.find((a) => a.name === 'Описание')
                      ?.value || ''
                  }
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      normalized: {
                        ...editing.normalized!,
                        product: {
                          ...editing.normalized!.product,
                          attributes: [
                            ...editing.normalized!.product.attributes.filter(
                              (a) => a.name !== 'Описание',
                            ),
                            ...(e.target.value
                              ? [{ name: 'Описание', value: e.target.value, unit: '' }]
                              : []),
                          ],
                        },
                      },
                    })
                  }
                />
              </label>
              <button
                className="btn-primary"
                onClick={() =>
                  void run(async () =>
                    accept(
                      await mutate({
                        action: 'correct',
                        revision: draft.revision,
                        rowId: editing.id,
                        normalized: editing.normalized,
                      }),
                    ),
                  )
                }
              >
                Сохранить исправление
              </button>
              <button className="btn-secondary" onClick={() => setEditing(null)}>
                Отменить исправление
              </button>
            </fieldset>
          )}
          {historical ? (
            <p>Историческая редакция: только просмотр.</p>
          ) : draft.status === 'draft' ? (
            <button
              className="btn-primary"
              disabled={busy || !selected.length || settingsChanged || !!editing}
              onClick={() =>
                void run(async () => {
                  accept(
                    await mutate({ action: 'confirm', revision: draft.revision, rowIds: selected }),
                  );
                  await onImported();
                })
              }
            >
              Импортировать подтвержденные строки ({selected.length})
            </button>
          ) : (
            <p role="status">
              Импорт подтвержден: {draft.rows.filter((row) => row.status === 'accepted').length}{' '}
              принято, {draft.rows.filter((row) => row.status === 'excluded').length} не выбрано,{' '}
              {draft.rows.filter((row) => row.status === 'error').length} с ошибками. Подтвердил{' '}
              {draft.confirmedBy} · {draft.confirmedAt}. Позиции добавлены в каталог.
            </p>
          )}
        </>
      )}
    </section>
  );
}
