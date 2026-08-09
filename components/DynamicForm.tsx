"use client";

import { COMPLEXITY_OPTIONS } from "@/lib/pm";

export interface FormFieldDef {
  id: string;
  label: string;
  key: string;
  type: string;
  options: string | null;
  required: boolean;
  order: number;
}

interface Props {
  fields: FormFieldDef[];
  values: Record<string, string | number | boolean>;
  onChange: (key: string, value: string | number | boolean) => void;
}

export default function DynamicForm({ fields, values, onChange }: Props) {
  if (fields.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        В этом шаблоне пока нет вопросов.
      </p>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map((field) => {
        const value = values[field.key] ?? "";
        const options: string[] = field.options
          ? JSON.parse(field.options)
          : [];
        return (
          <div key={field.id}>
            <label className="label">
              {field.label}
              {field.required ? (
                <span className="text-rose-500"> *</span>
              ) : null}
            </label>
            {field.type === "number" && (
              <input
                type="number"
                className="input"
                required={field.required}
                value={value as number}
                onChange={(e) =>
                  onChange(field.key, e.target.valueAsNumber || 0)
                }
              />
            )}
            {field.type === "text" && (
              <input
                type="text"
                className="input"
                required={field.required}
                value={value as string}
                onChange={(e) => onChange(field.key, e.target.value)}
              />
            )}
            {field.type === "textarea" && (
              <textarea
                className="input"
                rows={3}
                required={field.required}
                value={value as string}
                onChange={(e) => onChange(field.key, e.target.value)}
              />
            )}
            {field.type === "select" && (
              <select
                className="input"
                required={field.required}
                value={value as string}
                onChange={(e) => onChange(field.key, e.target.value)}
              >
                <option value="">— выбрать —</option>
                {options.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            )}
            {field.type === "complexity" && (
              <select
                className="input"
                required={field.required}
                value={value as string}
                onChange={(e) => onChange(field.key, e.target.value)}
              >
                <option value="">— выбрать —</option>
                {COMPLEXITY_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            )}
            {field.type === "checkbox" && (
              <input
                type="checkbox"
                className="h-5 w-5 rounded border-slate-300"
                checked={!!value}
                onChange={(e) => onChange(field.key, e.target.checked)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
