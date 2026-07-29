"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ROLES } from "@/lib/roles";
import { COMPLEXITY_LEVELS } from "@/lib/pm";

interface Field {
  id: string;
  label: string;
  key: string;
  type: string;
  options: string | null;
  required: boolean;
  order: number;
}

interface StageTemplate {
  id: string;
  name: string;
  role: string;
  baseHours: number;
  hoursPerUnit: number;
  driverFieldKey: string | null;
  order: number;
}

interface Template {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  fields: Field[];
  stageTemplates: StageTemplate[];
}

const FIELD_TYPES = [
  { value: "text", label: "Текст" },
  { value: "number", label: "Число" },
  { value: "select", label: "Список" },
  { value: "checkbox", label: "Флажок" },
  { value: "textarea", label: "Многострочный текст" },
  { value: "complexity", label: "Сложность проекта (влияет на РП)" },
];

export default function TemplateEditor({ template }: { template: Template }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function call(input: RequestInfo, init?: RequestInit) {
    setBusy(true);
    try {
      const res = await fetch(input, init);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "Ошибка запроса");
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function addField() {
    const label = `Вопрос ${template.fields.length + 1}`;
    const key = `field_${template.fields.length + 1}`;
    call(`/api/templates/${template.id}/fields`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, key, type: "number", required: false }),
    });
  }

  function updateField(field: Field, patch: Partial<Omit<Field, "options">> & { options?: string[] | string | null }) {
    call(`/api/templates/${template.id}/fields/${field.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  function removeField(field: Field) {
    if (!confirm(`Удалить вопрос «${field.label}»?`)) return;
    call(`/api/templates/${template.id}/fields/${field.id}`, { method: "DELETE" });
  }

  function addStageTemplate() {
    call(`/api/templates/${template.id}/stage-templates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `Этап ${template.stageTemplates.length + 1}`, role: "developer", baseHours: 8, hoursPerUnit: 0 }),
    });
  }

  function updateStageTemplate(st: StageTemplate, patch: Partial<StageTemplate>) {
    call(`/api/templates/${template.id}/stage-templates/${st.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  function removeStageTemplate(st: StageTemplate) {
    if (!confirm(`Удалить этап «${st.name}»?`)) return;
    call(`/api/templates/${template.id}/stage-templates/${st.id}`, { method: "DELETE" });
  }

  const numberFields = template.fields.filter((f) => f.type === "number");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{template.name}</h1>
          {template.description && <p className="text-sm text-slate-500">{template.description}</p>}
        </div>
        <Link href="/admin" className="btn-secondary">
          ← К шаблонам
        </Link>
      </div>

      <div className="card p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium">Вопросы опросника</h2>
          <button className="btn-secondary" disabled={busy} onClick={addField}>
            + Добавить вопрос
          </button>
        </div>
        <div className="space-y-2">
          {template.fields.map((field) => (
            <div key={field.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2">
              <input
                className="input w-48"
                defaultValue={field.label}
                onBlur={(e) => e.target.value !== field.label && updateField(field, { label: e.target.value })}
                placeholder="Подпись"
              />
              <input
                className="input w-36 font-mono text-xs"
                defaultValue={field.key}
                onBlur={(e) => e.target.value !== field.key && updateField(field, { key: e.target.value })}
                placeholder="ключ"
              />
              <select
                className="input w-40"
                value={field.type}
                onChange={(e) => updateField(field, { type: e.target.value })}
              >
                {FIELD_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              {field.type === "select" && (
                <input
                  className="input w-56"
                  defaultValue={field.options ? JSON.parse(field.options).join(", ") : ""}
                  onBlur={(e) =>
                    updateField(field, {
                      options: e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder="варианты через запятую"
                />
              )}
              {field.type === "complexity" && (
                <span className="text-xs text-slate-500">
                  Варианты фиксированы: {COMPLEXITY_LEVELS.map((l) => `${l.value} (+${l.percent}%)`).join(", ")}
                </span>
              )}
              <label className="flex items-center gap-1 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={field.required}
                  onChange={(e) => updateField(field, { required: e.target.checked })}
                />
                обязателен
              </label>
              <button
                className="btn-secondary ml-auto px-2 py-1 text-xs text-rose-600"
                onClick={() => removeField(field)}
              >
                Удалить
              </button>
            </div>
          ))}
          {template.fields.length === 0 && <p className="text-sm text-slate-500">Вопросов пока нет.</p>}
        </div>
      </div>

      <div className="card p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium">Формулы этапов и трудозатрат</h2>
          <button className="btn-secondary" disabled={busy} onClick={addStageTemplate}>
            + Добавить этап
          </button>
        </div>
        <p className="mb-3 text-xs text-slate-500">
          Трудозатраты этапа = базовые часы + часы на единицу × значение числового вопроса. Для этапов с ролью
          «консультант», «разработчик», «инженер», «аналитик» автоматически добавляется 3-дневное согласование
          с заказчиком. В каждый расчёт также автоматически добавляется РП: 16 ч на старт и закрытие проекта +
          10%/20%/30% от суммарных трудозатрат остальных этапов — в зависимости от значения вопроса типа
          «Сложность проекта».
        </p>
        <div className="space-y-2">
          {template.stageTemplates.map((st) => (
            <div key={st.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2">
              <input
                className="input w-48"
                defaultValue={st.name}
                onBlur={(e) => e.target.value !== st.name && updateStageTemplate(st, { name: e.target.value })}
              />
              <select className="input w-40" value={st.role} onChange={(e) => updateStageTemplate(st, { role: e.target.value })}>
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-1 text-xs">
                <span className="text-slate-500">база</span>
                <input
                  type="number"
                  className="input w-20"
                  defaultValue={st.baseHours}
                  onBlur={(e) => updateStageTemplate(st, { baseHours: e.target.valueAsNumber || 0 })}
                />
                <span className="text-slate-500">ч +</span>
                <input
                  type="number"
                  className="input w-20"
                  defaultValue={st.hoursPerUnit}
                  onBlur={(e) => updateStageTemplate(st, { hoursPerUnit: e.target.valueAsNumber || 0 })}
                />
                <span className="text-slate-500">ч ×</span>
              </div>
              <select
                className="input w-48"
                value={st.driverFieldKey ?? ""}
                onChange={(e) => updateStageTemplate(st, { driverFieldKey: e.target.value || null })}
              >
                <option value="">— без множителя —</option>
                {numberFields.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
              <button
                className="btn-secondary ml-auto px-2 py-1 text-xs text-rose-600"
                onClick={() => removeStageTemplate(st)}
              >
                Удалить
              </button>
            </div>
          ))}
          {template.stageTemplates.length === 0 && <p className="text-sm text-slate-500">Этапов пока нет.</p>}
        </div>
      </div>
    </div>
  );
}
