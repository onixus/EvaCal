'use client';
import { useState } from 'react';
import {
  ATTRIBUTE_TYPE_LABELS,
  ATTRIBUTE_VALUE_TYPES,
  type AttributeDefinition,
  type AttributeValueType,
} from '@/lib/catalog/attributes';

const split = (value: string) =>
  value
    .split(/[,;]/)
    .map((v) => v.trim())
    .filter(Boolean);
const blank = {
  key: '',
  label: '',
  valueType: 'text' as AttributeValueType,
  unit: '',
  allowedUnits: '',
  enumValues: '',
};

/** Typed attribute definitions; products with matching attributes are validated. */
export default function AttributeDefinitionsPanel({
  definitions,
  busy,
  mutate,
}: {
  definitions: AttributeDefinition[];
  busy: boolean;
  mutate: (body: unknown, done?: () => void) => Promise<void>;
}) {
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<AttributeDefinition | null>(null);
  const definition = {
    key: form.key,
    label: form.label,
    valueType: form.valueType,
    unit: form.unit.trim() || null,
    allowedUnits: split(form.allowedUnits).length ? split(form.allowedUnits) : null,
    enumValues: split(form.enumValues).length ? split(form.enumValues) : null,
  };
  return (
    <fieldset disabled={busy} className="card space-y-3 p-4">
      <legend>Справочник характеристик</legend>
      <p className="text-sm text-slate-500">
        Характеристика позиции, совпадающая по ключу или названию, проверяется: число, единица из
        допустимых, значение перечня. Характеристики без справочника разрешены, но отмечаются в
        карточке позиции.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label>
          Ключ
          <input
            className="input w-full"
            value={form.key}
            onChange={(e) => setForm({ ...form, key: e.target.value })}
          />
        </label>
        <label>
          Название
          <input
            className="input w-full"
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
          />
        </label>
        <label>
          Тип значения
          <select
            className="input w-full"
            value={form.valueType}
            onChange={(e) => setForm({ ...form, valueType: e.target.value as AttributeValueType })}
          >
            {ATTRIBUTE_VALUE_TYPES.map((t) => (
              <option key={t} value={t}>
                {ATTRIBUTE_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Единица по умолчанию
          <input
            className="input w-full"
            value={form.unit}
            onChange={(e) => setForm({ ...form, unit: e.target.value })}
          />
        </label>
        <label>
          Допустимые единицы (через запятую)
          <input
            className="input w-full"
            value={form.allowedUnits}
            onChange={(e) => setForm({ ...form, allowedUnits: e.target.value })}
          />
        </label>
        {form.valueType === 'enum' && (
          <label>
            Значения перечня (через запятую)
            <input
              className="input w-full"
              value={form.enumValues}
              onChange={(e) => setForm({ ...form, enumValues: e.target.value })}
            />
          </label>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          className="btn-primary"
          disabled={!form.key.trim() || !form.label.trim()}
          onClick={() =>
            mutate(
              editing
                ? {
                    action: 'attribute.update',
                    id: editing.id,
                    revision: editing.revision,
                    definition,
                  }
                : { action: 'attribute.create', definition },
              () => {
                setForm(blank);
                setEditing(null);
              },
            )
          }
        >
          {editing ? 'Сохранить характеристику' : 'Добавить характеристику в справочник'}
        </button>
        {editing && (
          <button
            className="btn-secondary"
            onClick={() => {
              setEditing(null);
              setForm(blank);
            }}
          >
            Отменить
          </button>
        )}
      </div>
      <ul className="space-y-1 text-sm">
        {definitions
          .filter((d) => !d.archived)
          .map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2">
              <span>
                {d.label} ({d.key}) · {ATTRIBUTE_TYPE_LABELS[d.valueType]}
                {d.unit ? ` · ${d.unit}` : ''}
                {d.allowedUnits ? ` · единицы: ${d.allowedUnits.join(', ')}` : ''}
                {d.enumValues ? ` · значения: ${d.enumValues.join(', ')}` : ''}
              </span>
              <button
                className="btn-secondary"
                onClick={() => {
                  setEditing(d);
                  setForm({
                    key: d.key,
                    label: d.label,
                    valueType: d.valueType,
                    unit: d.unit ?? '',
                    allowedUnits: (d.allowedUnits ?? []).join(', '),
                    enumValues: (d.enumValues ?? []).join(', '),
                  });
                }}
              >
                Изменить
              </button>
              <button
                className="btn-secondary"
                onClick={() => {
                  if (window.confirm('Архивировать характеристику? Проверка по ней прекратится.'))
                    void mutate({ action: 'attribute.archive', id: d.id, revision: d.revision });
                }}
              >
                Архивировать
              </button>
            </li>
          ))}
      </ul>
    </fieldset>
  );
}
