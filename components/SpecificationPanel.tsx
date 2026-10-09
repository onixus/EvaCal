'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { withShareHeaders } from '@/lib/shareClient';
import type {
  SpecificationSnapshot,
  SpecificationItem,
  SavedSpecification,
} from '@/lib/specification/types';
import { ITEM_KINDS, ITEM_DISPOSITIONS } from '@/lib/specification/types';
import { specificationBlockers } from '@/lib/specification/validation';

interface SpecificationPanelProps {
  calculationId: string;
  calculationName: string;
  customerName: string;
  answers: Record<string, unknown>;
  studioHref?: string;
}
const kindLabels = {
  hardware: 'Оборудование',
  software: 'ПО',
  license: 'Лицензия',
  support: 'Поддержка',
  service: 'Услуга',
  other: 'Другое',
};
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
  id: crypto.randomUUID(),
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [canWrite, setCanWrite] = useState(false);
  const [canExport, setCanExport] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState('');
  const [reload, setReload] = useState(0);
  const answersKey = JSON.stringify(answers);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
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
  const edit = (id: string, field: keyof SpecificationItem, value: unknown) =>
    change({
      ...spec,
      items: spec.items.map((i) =>
        i.id === id
          ? { ...i, [field]: value, confirmed: field === 'confirmed' ? Boolean(value) : false }
          : i,
      ),
    });
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
  const download = async (draft: boolean) => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/calculations/${calculationId}/gost34`, {
        method: 'POST',
        headers: withShareHeaders(calculationId, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          docType: 'SPEC',
          draft,
          specificationVersion: spec.version || undefined,
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
  const blockers = specificationBlockers(spec);
  const historical = Boolean(selectedVersion);
  const disabled = loading || busy || !canWrite || historical;
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
  ];

  return (
    <div className="space-y-4">
      <div className="card space-y-3 p-5">
        <h2 className="text-lg font-bold">Спецификация — {customerName}</h2>
        <p className="text-sm text-slate-500">
          Версия {spec.version || 'не сохранена'} ·{' '}
          {dirty
            ? 'Есть несохраненные изменения'
            : spec.status === 'confirmed'
              ? 'Подтверждена'
              : 'Черновик'}
          . Состав вводится вручную. Ответы опросника не добавляют товары. Реестры автоматически не
          проверяются.
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
              disabled={busy || dirty}
              onChange={(e) => setSelectedVersion(e.target.value)}
            />
          </label>
          <button
            className="btn-secondary"
            disabled={busy || dirty}
            onClick={() => {
              setSelectedVersion('');
              setReload((n) => n + 1);
            }}
          >
            Загрузить последнюю
          </button>
          <button
            className="btn-secondary"
            disabled={loading || busy || dirty || !canExport}
            onClick={() => download(true)}
          >
            Черновой DOCX
          </button>
          <button
            className="btn-primary"
            disabled={loading || busy || dirty || blockers.length > 0 || !canExport}
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
          {spec.items.map((item, index) => (
            <fieldset key={item.id} disabled={disabled} className="card space-y-3 p-5">
              <legend className="font-semibold">Позиция {index + 1}</legend>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <label>
                  Тип
                  <select
                    className="input w-full"
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
                  onClick={() =>
                    change({ ...spec, items: spec.items.filter((i) => i.id !== item.id) })
                  }
                >
                  Удалить
                </button>
                <button
                  className="btn-secondary"
                  onClick={() =>
                    change({
                      ...spec,
                      items: [
                        ...spec.items,
                        { ...item, id: crypto.randomUUID(), confirmed: false },
                      ],
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
            <div className="flex flex-wrap gap-2">
              <button
                className="btn-secondary"
                disabled={disabled}
                onClick={() => change({ ...spec, items: [...spec.items, newItem()] })}
              >
                Добавить позицию
              </button>
              <button className="btn-secondary" disabled={disabled} onClick={() => save('draft')}>
                Сохранить новую редакцию
              </button>
              <button className="btn-primary" disabled={disabled} onClick={() => save('confirmed')}>
                Подтвердить и сохранить
              </button>
            </div>
            <p className="text-sm text-slate-500">
              Сохранение создает новую неизменяемую редакцию. Изменение строки снимает ее
              подтверждение. Цены сохраняются в спецификации; связь с расчетом стоимости КП
              выполняется отдельно.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
