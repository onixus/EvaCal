"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import DynamicForm, { FormFieldDef } from "@/components/DynamicForm";
import StageTable, { StageRow } from "@/components/StageTable";
import GanttChart from "@/components/GanttChart";
import StatusBadge from "@/components/StatusBadge";
import TotalsSummary, { RiskRow } from "@/components/TotalsSummary";
import RiskList from "@/components/RiskList";

interface Calculation {
  id: string;
  name: string;
  customer: string;
  status: string;
  startDate: string;
  pmHours: number;
  answers: Record<string, string | number | boolean>;
  template: {
    id: string;
    name: string;
    fields: FormFieldDef[];
    defaultStartDate: string | null;
  };
  stages: StageRow[];
  risks: RiskRow[];
}

export default function PresaleCalculationEditor({ calculation }: { calculation: Calculation }) {
  const router = useRouter();
  const [name, setName] = useState(calculation.name);
  const [customer, setCustomer] = useState(calculation.customer);
  const [startDate, setStartDate] = useState(calculation.startDate.slice(0, 10));
  const [answers, setAnswers] = useState(calculation.answers);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = calculation.status === "approved";
  const startDateLocked = locked || !!calculation.template.defaultStartDate;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/calculations/${calculation.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, customer, answers, startDate }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Не удалось сохранить");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  }

  async function submitForApproval() {
    setSaving(true);
    try {
      await fetch(`/api/calculations/${calculation.id}/submit`, { method: "POST" });
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <h1 className="text-xl font-semibold">Расчёт: {calculation.name}</h1>
        <StatusBadge status={calculation.status} />
      </div>

      <div className="card space-y-5 p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Название проекта</label>
            <input className="input" disabled={locked} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="label">Заказчик</label>
            <input
              className="input"
              disabled={locked}
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
            />
          </div>
          <div>
            <label className="label">
              Дата старта проекта
              {startDateLocked && <span className="ml-1 text-xs text-slate-400">(зафиксирована)</span>}
            </label>
            <input
              type="date"
              className="input"
              disabled={startDateLocked}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-medium text-slate-700">Опросник «{calculation.template.name}»</h3>
          <fieldset disabled={locked}>
            <DynamicForm
              fields={calculation.template.fields}
              values={answers}
              onChange={(key, value) => setAnswers((prev) => ({ ...prev, [key]: value }))}
            />
          </fieldset>
        </div>

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <div className="flex gap-3">
          <button className="btn-primary" disabled={saving || locked} onClick={save}>
            {saving ? "Сохранение…" : "Пересчитать"}
          </button>
          <button
            className="btn-secondary"
            disabled={saving || locked || calculation.status === "pending_approval"}
            onClick={submitForApproval}
          >
            Отправить архитектору на согласование
          </button>
        </div>
      </div>

      <div className="card p-5">
        <h2 className="mb-3 font-medium">Трудозатраты</h2>
        <TotalsSummary stages={calculation.stages} pmHours={calculation.pmHours} risks={calculation.risks} />
      </div>

      <div className="card p-5">
        <h2 className="mb-3 font-medium">Этапы</h2>
        <StageTable stages={calculation.stages} />
      </div>

      <div className="card p-5">
        <h2 className="mb-3 font-medium">Диаграмма Ганта</h2>
        <GanttChart stages={calculation.stages} />
      </div>

      {calculation.risks.length > 0 && (
        <div className="card p-5">
          <h2 className="mb-3 font-medium">Риски</h2>
          <RiskList risks={calculation.risks} />
        </div>
      )}
    </div>
  );
}
