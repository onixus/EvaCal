"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ROLES } from "@/lib/roles";
import { COMPLEXITY_LEVELS } from "@/lib/pm";
import { MIN_WORK_DAY_HOURS, MAX_WORK_DAY_HOURS } from "@/lib/scheduling";

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
  requirements: string | null;
  order: number;
}

interface RiskTemplate {
  id: string;
  description: string;
  hours: number;
  order: number;
}

interface Template {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  defaultStartDate: string | null;
  workDayHours: number;
  includeWeekends: boolean;
  fields: Field[];
  stageTemplates: StageTemplate[];
  riskTemplates: RiskTemplate[];
}

const FIELD_TYPES = [
  { value: "text", label: "Текст" },
  { value: "number", label: "Число" },
  { value: "select", label: "Список" },
  { value: "checkbox", label: "Флажок" },
  { value: "textarea", label: "Многострочный текст" },
  { value: "complexity", label: "Сложность проекта (влияет на РП)" },
];

function moveItem<T>(list: T[], from: number, to: number): T[] {
  const copy = [...list];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

export default function TemplateEditor({ template }: { template: Template }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  // Local, reorderable copies so drag-and-drop feels instant instead of waiting on a refetch.
  // Re-synced from props whenever the server data changes (add/remove/refresh).
  const [fields, setFields] = useState(template.fields);
  const [stageTemplates, setStageTemplates] = useState(template.stageTemplates);
  useEffect(() => setFields(template.fields), [template.fields]);
  useEffect(
    () => setStageTemplates(template.stageTemplates),
    [template.stageTemplates],
  );

  const [fieldDragIndex, setFieldDragIndex] = useState<number | null>(null);
  const [stageDragIndex, setStageDragIndex] = useState<number | null>(null);

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

  /** Persists the new order (0..n-1) for every reordered item in one batch, then refreshes. */
  async function persistOrder(baseUrl: string, items: { id: string }[]) {
    setBusy(true);
    try {
      await Promise.all(
        items.map((item, i) =>
          fetch(`${baseUrl}/${item.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ order: i }),
          }),
        ),
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function dropField(toIndex: number) {
    if (fieldDragIndex === null || fieldDragIndex === toIndex) return;
    const reordered = moveItem(fields, fieldDragIndex, toIndex);
    setFieldDragIndex(null);
    setFields(reordered);
    persistOrder(`/api/templates/${template.id}/fields`, reordered);
  }

  function dropStageTemplate(toIndex: number) {
    if (stageDragIndex === null || stageDragIndex === toIndex) return;
    const reordered = moveItem(stageTemplates, stageDragIndex, toIndex);
    setStageDragIndex(null);
    setStageTemplates(reordered);
    persistOrder(`/api/templates/${template.id}/stage-templates`, reordered);
  }

  function addField() {
    const label = `Вопрос ${fields.length + 1}`;
    const key = `field_${fields.length + 1}`;
    call(`/api/templates/${template.id}/fields`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, key, type: "number", required: false }),
    });
  }

  function updateField(
    field: Field,
    patch: Partial<Omit<Field, "options">> & {
      options?: string[] | string | null;
    },
  ) {
    call(`/api/templates/${template.id}/fields/${field.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  function removeField(field: Field) {
    if (!confirm(`Удалить вопрос «${field.label}»?`)) return;
    call(`/api/templates/${template.id}/fields/${field.id}`, {
      method: "DELETE",
    });
  }

  function addStageTemplate() {
    call(`/api/templates/${template.id}/stage-templates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `Этап ${stageTemplates.length + 1}`,
        role: "developer",
        baseHours: 8,
        hoursPerUnit: 0,
      }),
    });
  }

  function updateStageTemplate(
    st: StageTemplate,
    patch: Partial<StageTemplate>,
  ) {
    call(`/api/templates/${template.id}/stage-templates/${st.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  function removeStageTemplate(st: StageTemplate) {
    if (!confirm(`Удалить этап «${st.name}»?`)) return;
    call(`/api/templates/${template.id}/stage-templates/${st.id}`, {
      method: "DELETE",
    });
  }

  function addRiskTemplate() {
    call(`/api/templates/${template.id}/risk-templates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: `Риск ${template.riskTemplates.length + 1}`,
        hours: 0,
      }),
    });
  }

  function updateRiskTemplate(rt: RiskTemplate, patch: Partial<RiskTemplate>) {
    call(`/api/templates/${template.id}/risk-templates/${rt.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  function removeRiskTemplate(rt: RiskTemplate) {
    if (!confirm(`Удалить риск «${rt.description}»?`)) return;
    call(`/api/templates/${template.id}/risk-templates/${rt.id}`, {
      method: "DELETE",
    });
  }

  function updateTemplate(patch: {
    name?: string;
    description?: string | null;
    defaultStartDate?: string | null;
    workDayHours?: number;
    includeWeekends?: boolean;
  }) {
    call(`/api/templates/${template.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  const numberFields = fields.filter((f) => f.type === "number");

  async function duplicateTemplate() {
    setBusy(true);
    try {
      const res = await fetch(`/api/templates/${template.id}/duplicate`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        router.push(`/admin/${data.id}`);
      } else {
        alert(data.error ?? "Ошибка запроса");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <input
            className="input w-full max-w-md text-xl font-semibold"
            defaultValue={template.name}
            onBlur={(e) =>
              e.target.value.trim() &&
              e.target.value !== template.name &&
              updateTemplate({ name: e.target.value.trim() })
            }
          />
          <input
            className="input mt-2 w-full max-w-md text-sm"
            defaultValue={template.description ?? ""}
            placeholder="Описание (необязательно)"
            onBlur={(e) =>
              e.target.value !== (template.description ?? "") &&
              updateTemplate({ description: e.target.value || null })
            }
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn-secondary"
            disabled={busy}
            onClick={duplicateTemplate}
          >
            Копировать шаблон
          </button>
          <Link href="/admin" className="btn-secondary">
            ← К шаблонам
          </Link>
        </div>
      </div>

      <div className="card p-6">
        <h2 className="mb-1 font-medium">Дата старта проекта (опционально)</h2>
        <p className="mb-3 text-xs text-slate-500">
          Если заполнено — дата фиксируется для всех расчётов по шаблону,
          пресейл её не может изменить (только архитектор). Если оставить пустым
          — пресейл сам укажет дату при создании расчёта, а после утверждения
          архитектором она зафиксируется.
        </p>
        <div className="max-w-xs">
          <input
            type="date"
            className="input"
            defaultValue={
              template.defaultStartDate
                ? template.defaultStartDate.slice(0, 10)
                : ""
            }
            onBlur={(e) =>
              updateTemplate({ defaultStartDate: e.target.value || null })
            }
          />
        </div>
      </div>

      <div className="card p-6">
        <h2 className="mb-1 font-medium">Рабочий график</h2>
        <p className="mb-3 text-xs text-slate-500">
          Длительность рабочего дня (используется при расчёте дат этапов на
          Ганте, старт всегда с 9:00) и учитывать ли выходные как рабочие дни.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <label className="label">Рабочий день, ч</label>
            <input
              type="number"
              min={MIN_WORK_DAY_HOURS}
              max={MAX_WORK_DAY_HOURS}
              className="input w-28"
              defaultValue={template.workDayHours}
              onBlur={(e) =>
                updateTemplate({
                  workDayHours: e.target.valueAsNumber || template.workDayHours,
                })
              }
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={template.includeWeekends}
              onChange={(e) =>
                updateTemplate({ includeWeekends: e.target.checked })
              }
            />
            Учитывать выходные как рабочие дни
          </label>
        </div>
      </div>

      <div className="card p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium">Вопросы опросника</h2>
          <button className="btn-secondary" disabled={busy} onClick={addField}>
            + Добавить вопрос
          </button>
        </div>
        <div className="space-y-2">
          {fields.map((field, index) => (
            <div
              key={field.id}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => dropField(index)}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2"
            >
              <span
                draggable
                onDragStart={() => setFieldDragIndex(index)}
                onDragEnd={() => setFieldDragIndex(null)}
                className="cursor-grab select-none px-1 text-slate-400 active:cursor-grabbing"
                title="Перетащить для изменения порядка"
              >
                ⠿
              </span>
              <input
                className="input w-48"
                defaultValue={field.label}
                onBlur={(e) =>
                  e.target.value !== field.label &&
                  updateField(field, { label: e.target.value })
                }
                placeholder="Подпись"
              />
              <input
                className="input w-36 font-mono text-xs"
                defaultValue={field.key}
                onBlur={(e) =>
                  e.target.value !== field.key &&
                  updateField(field, { key: e.target.value })
                }
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
                  defaultValue={
                    field.options ? JSON.parse(field.options).join(", ") : ""
                  }
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
                  Варианты фиксированы:{" "}
                  {COMPLEXITY_LEVELS.map(
                    (l) => `${l.value} (+${l.percent}%)`,
                  ).join(", ")}
                </span>
              )}
              <label className="flex items-center gap-1 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={field.required}
                  onChange={(e) =>
                    updateField(field, { required: e.target.checked })
                  }
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
          {fields.length === 0 && (
            <p className="text-sm text-slate-500">Вопросов пока нет.</p>
          )}
        </div>
      </div>

      <div className="card p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium">Формулы этапов и трудозатрат</h2>
          <button
            className="btn-secondary"
            disabled={busy}
            onClick={addStageTemplate}
          >
            + Добавить этап
          </button>
        </div>
        <p className="mb-3 text-xs text-slate-500">
          Трудозатраты этапа = базовые часы + часы на единицу × значение
          числового вопроса. Для этапов с ролью «консультант», «разработчик»,
          «инженер», «аналитик» автоматически добавляется согласование с
          заказчиком (по умолчанию 3 рабочих дня — архитектор может изменить
          длительность для конкретного этапа). В итоговые трудозатраты расчёта
          также автоматически добавляется РП: 16 ч на старт и закрытие проекта +
          10%/20%/30% от суммарных трудозатрат остальных этапов — в зависимости
          от значения вопроса типа «Сложность проекта». РП не отображается как
          отдельный этап на Ганте.
        </p>
        <div className="space-y-2">
          {stageTemplates.map((st, index) => (
            <div
              key={st.id}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => dropStageTemplate(index)}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2"
            >
              <span
                draggable
                onDragStart={() => setStageDragIndex(index)}
                onDragEnd={() => setStageDragIndex(null)}
                className="cursor-grab select-none px-1 text-slate-400 active:cursor-grabbing"
                title="Перетащить для изменения порядка"
              >
                ⠿
              </span>
              <input
                className="input w-48"
                defaultValue={st.name}
                onBlur={(e) =>
                  e.target.value !== st.name &&
                  updateStageTemplate(st, { name: e.target.value })
                }
              />
              <select
                className="input w-40"
                value={st.role}
                onChange={(e) =>
                  updateStageTemplate(st, { role: e.target.value })
                }
              >
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
                  onBlur={(e) =>
                    updateStageTemplate(st, {
                      baseHours: e.target.valueAsNumber || 0,
                    })
                  }
                />
                <span className="text-slate-500">ч +</span>
                <input
                  type="number"
                  className="input w-20"
                  defaultValue={st.hoursPerUnit}
                  onBlur={(e) =>
                    updateStageTemplate(st, {
                      hoursPerUnit: e.target.valueAsNumber || 0,
                    })
                  }
                />
                <span className="text-slate-500">ч ×</span>
              </div>
              <select
                className="input w-48"
                value={st.driverFieldKey ?? ""}
                onChange={(e) =>
                  updateStageTemplate(st, {
                    driverFieldKey: e.target.value || null,
                  })
                }
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
              <textarea
                className="input w-full"
                rows={2}
                defaultValue={st.requirements ?? ""}
                placeholder="Требования и ограничения по умолчанию (архитектор сможет изменить для конкретного расчёта)"
                onBlur={(e) =>
                  e.target.value !== (st.requirements ?? "") &&
                  updateStageTemplate(st, {
                    requirements: e.target.value || null,
                  })
                }
              />
            </div>
          ))}
          {stageTemplates.length === 0 && (
            <p className="text-sm text-slate-500">Этапов пока нет.</p>
          )}
        </div>
      </div>

      <div className="card p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium">Базовые риски</h2>
          <button
            className="btn-secondary"
            disabled={busy}
            onClick={addRiskTemplate}
          >
            + Добавить риск
          </button>
        </div>
        <p className="mb-3 text-xs text-slate-500">
          Эти риски автоматически добавляются в каждый новый расчёт по шаблону —
          архитектор сможет отредактировать или удалить их для конкретного
          расчёта.
        </p>
        <div className="space-y-2">
          {template.riskTemplates.map((rt) => (
            <div
              key={rt.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2"
            >
              <input
                className="input flex-1"
                defaultValue={rt.description}
                onBlur={(e) =>
                  e.target.value !== rt.description &&
                  updateRiskTemplate(rt, { description: e.target.value })
                }
                placeholder="Описание риска"
              />
              <div className="flex items-center gap-1 text-xs">
                <input
                  type="number"
                  className="input w-20"
                  defaultValue={rt.hours}
                  onBlur={(e) =>
                    updateRiskTemplate(rt, {
                      hours: e.target.valueAsNumber || 0,
                    })
                  }
                />
                <span className="text-slate-500">ч</span>
              </div>
              <button
                className="btn-secondary px-2 py-1 text-xs text-rose-600"
                onClick={() => removeRiskTemplate(rt)}
              >
                Удалить
              </button>
            </div>
          ))}
          {template.riskTemplates.length === 0 && (
            <p className="text-sm text-slate-500">Базовых рисков пока нет.</p>
          )}
        </div>
      </div>
    </div>
  );
}
