'use client';
import { useState } from 'react';
import { withShareHeaders } from '@/lib/shareClient';
import type { SavedSpecification, SpecificationSnapshot } from '@/lib/specification/types';
import {
  BOM_FIELDS,
  mergeBomRows,
  type BomField,
  type BomPreview,
} from '@/lib/specification/bom-types';

const fieldLabels: Record<BomField, string> = {
  name: 'Наименование',
  vendor: 'Вендор',
  sku: 'Артикул',
  kind: 'Тип',
  quantity: 'Количество',
  unit: 'Единица',
  configuration: 'Характеристики',
  licensing: 'Лицензирование',
  term: 'Срок / условия',
  unitPrice: 'Цена за единицу',
  currency: 'Валюта',
  source: 'Источник',
  rationale: 'Основание',
  rowId: 'ID строки (для состава комплекта)',
  includedIn: 'Входит в комплект (ID строки)',
};

/**
 * BOM import: preview rows with errors first; only explicitly selected valid rows
 * are saved, always as a new draft revision through the regular save endpoint.
 */
export default function BomImportPanel({
  calculationId,
  snapshot,
  enabled,
  disabledReason,
  onBusy,
  onSaved,
}: {
  calculationId: string;
  snapshot: SpecificationSnapshot;
  enabled: boolean;
  disabledReason: string;
  onBusy: (busy: boolean) => void;
  onSaved: (saved: SavedSpecification) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<BomPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<'append' | 'replace'>('append');
  const [delimiter, setDelimiter] = useState(';');
  const [decimalSeparator, setDecimalSeparator] = useState('.');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (profile: Record<string, unknown>) => {
    if (!file) return;
    setBusy(true);
    onBusy(true);
    setError('');
    try {
      const form = new FormData();
      form.set('file', file);
      form.set('profile', JSON.stringify({ delimiter, decimalSeparator, ...profile }));
      const res = await fetch(`/api/calculations/${calculationId}/specification/import`, {
        method: 'POST',
        headers: withShareHeaders(calculationId),
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Не удалось разобрать файл');
      const next = data as BomPreview;
      setPreview(next);
      setSelected(new Set(next.rows.filter((r) => !r.errors.length).map((r) => r.id)));
    } catch (err) {
      setPreview(null);
      setError(err instanceof Error ? err.message : 'Ошибка импорта');
    } finally {
      setBusy(false);
      onBusy(false);
    }
  };
  const remap = (field: BomField, value: string) => {
    if (!preview) return;
    const mapping = { ...preview.profile.mapping };
    if (value === '') delete mapping[field];
    else mapping[field] = Number(value);
    run({ ...preview.profile, mapping });
  };
  const save = async () => {
    if (!preview) return;
    setBusy(true);
    onBusy(true);
    setError('');
    try {
      const next = mergeBomRows(snapshot, preview, [...selected], mode);
      const res = await fetch(`/api/calculations/${calculationId}/specification`, {
        method: 'POST',
        headers: withShareHeaders(calculationId, { 'Content-Type': 'application/json' }),
        body: JSON.stringify(next),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Не удалось сохранить');
      setPreview(null);
      setSelected(new Set());
      onSaved(data as SavedSpecification);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setBusy(false);
      onBusy(false);
    }
  };
  const valid = preview?.rows.filter((r) => !r.errors.length).length ?? 0;
  const disabled = !enabled || busy;

  return (
    <details className="card space-y-3 p-5">
      <summary className="font-semibold">Импорт BOM из XLSX/CSV</summary>
      {!enabled && <p className="text-sm text-slate-500">{disabledReason}</p>}
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          Файл BOM
          <input
            aria-label="Файл BOM"
            type="file"
            accept=".xlsx,.csv"
            className="block"
            disabled={disabled}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
            }}
          />
        </label>
        <label className="text-sm">
          Разделитель CSV
          <select
            className="input"
            value={delimiter}
            disabled={disabled}
            onChange={(e) => setDelimiter(e.target.value)}
          >
            <option value=";">;</option>
            <option value=",">,</option>
            <option value={'\t'}>Tab</option>
          </select>
        </label>
        <label className="text-sm">
          Десятичный разделитель
          <select
            className="input"
            value={decimalSeparator}
            disabled={disabled}
            onChange={(e) => setDecimalSeparator(e.target.value)}
          >
            <option value=".">.</option>
            <option value=",">,</option>
          </select>
        </label>
        <button
          className="btn-secondary"
          disabled={disabled || !file}
          onClick={() => run(preview ? { ...preview.profile } : {})}
        >
          Предпросмотр BOM
        </button>
      </div>
      {error && (
        <p role="alert" className="whitespace-pre-line text-red-600">
          {error}
        </p>
      )}
      {preview && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {preview.sheets.length > 1 && (
              <label className="text-sm">
                Лист
                <select
                  className="input"
                  value={preview.profile.sheet}
                  disabled={disabled}
                  onChange={(e) => run({ ...preview.profile, sheet: e.target.value, mapping: {} })}
                >
                  {preview.sheets.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
            )}
            {BOM_FIELDS.map((field) => (
              <label key={field} className="text-sm">
                {fieldLabels[field]}
                <select
                  aria-label={`Колонка: ${fieldLabels[field]}`}
                  className="input"
                  value={preview.profile.mapping[field] ?? ''}
                  disabled={disabled}
                  onChange={(e) => remap(field, e.target.value)}
                >
                  <option value="">—</option>
                  {preview.headers.map((h, i) => (
                    <option key={i} value={i}>
                      {i + 1}. {h || '(без заголовка)'}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <p className="text-sm">
            Строк: {preview.rows.length} · допустимых: {valid} · с ошибками:{' '}
            {preview.rows.length - valid} · выбрано: {selected.size}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th>Импорт</th>
                  <th>Строка</th>
                  <th>Наименование</th>
                  <th>Артикул</th>
                  <th>Количество</th>
                  <th>Цена</th>
                  <th>Ошибки</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.id} className={row.errors.length ? 'text-red-700' : ''}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Импортировать строку ${row.rowNumber}`}
                        disabled={disabled || row.errors.length > 0}
                        checked={selected.has(row.id)}
                        onChange={(e) => {
                          const next = new Set(selected);
                          if (e.target.checked) next.add(row.id);
                          else next.delete(row.id);
                          setSelected(next);
                        }}
                      />
                    </td>
                    <td>{row.rowNumber}</td>
                    <td>{row.item?.name ?? ''}</td>
                    <td>{row.item?.sku ?? ''}</td>
                    <td>{row.item ? (row.item.quantity ?? 'неизвестно') : ''}</td>
                    <td>
                      {row.item
                        ? row.item.unitPrice === null
                          ? 'неизвестна'
                          : `${row.item.unitPrice} ${row.item.currency}`
                        : ''}
                    </td>
                    <td>{row.errors.join('; ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex gap-2 text-sm">
              <input
                type="radio"
                name="bom-mode"
                checked={mode === 'append'}
                onChange={() => setMode('append')}
              />
              Добавить к текущему составу
            </label>
            <label className="flex gap-2 text-sm">
              <input
                type="radio"
                name="bom-mode"
                checked={mode === 'replace'}
                onChange={() => setMode('replace')}
              />
              Заменить состав
            </label>
            <button
              className="btn-primary"
              disabled={disabled || selected.size === 0}
              onClick={save}
            >
              Создать черновик из выбранных строк
            </button>
          </div>
          <p className="text-sm text-slate-500">
            Импортированные строки не подтверждены; источником указаны файл, лист и строка, если
            колонка источника не сопоставлена. Сохранение создает новую черновую редакцию.
          </p>
        </div>
      )}
    </details>
  );
}
