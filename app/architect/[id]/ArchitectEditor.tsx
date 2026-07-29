"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ROLES } from "@/lib/roles";
import StageTable, { StageRow } from "@/components/StageTable";
import GanttChart from "@/components/GanttChart";
import StatusBadge from "@/components/StatusBadge";
import TotalsSummary, { RiskRow } from "@/components/TotalsSummary";

interface Calculation {
  id: string;
  name: string;
  customer: string;
  status: string;
  startDate: string;
  pmHours: number;
  template: { name: string };
  stages: StageRow[];
  risks: RiskRow[];
}

interface EditableStage {
  key: string;
  name: string;
  role: string;
  hours: number;
  requirements: string;
}

let uid = 0;
function nextKey() {
  uid += 1;
  return `new-${uid}`;
}

export default function ArchitectEditor({ calculation }: { calculation: Calculation }) {
  const router = useRouter();
  const [stages, setStages] = useState<EditableStage[]>(
    calculation.stages
      .filter((s) => !s.isApprovalTask)
      .map((s) => ({ key: s.id, name: s.name, role: s.role, hours: s.hours, requirements: s.requirements ?? "" }))
  );
  const [startDate, setStartDate] = useState(calculation.startDate.slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [riskBusy, setRiskBusy] = useState(false);
  const [newRiskDescription, setNewRiskDescription] = useState("");
  const [newRiskHours, setNewRiskHours] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const locked = calculation.status === "approved";

  async function saveSchedule() {
    setScheduleSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/calculations/${calculation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Не удалось сохранить");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setScheduleSaving(false);
    }
  }

  function updateStage(key: string, patch: Partial<EditableStage>) {
    setStages((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }

  function addStage() {
    setStages((prev) => [
      ...prev,
      { key: nextKey(), name: "Новый этап", role: "developer", hours: 8, requirements: "" },
    ]);
  }

  function removeStage(key: string) {
    setStages((prev) => prev.filter((s) => s.key !== key));
  }

  function moveStage(index: number, dir: -1 | 1) {
    setStages((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/calculations/${calculation.id}/stages`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stages: stages.map((s) => ({
            name: s.name,
            role: s.role,
            hours: Number(s.hours) || 0,
            requirements: s.requirements || null,
          })),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Не удалось сохранить этапы");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  }

  async function approve() {
    setSaving(true);
    try {
      await fetch(`/api/calculations/${calculation.id}/approve`, { method: "POST" });
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function addRisk() {
    if (!newRiskDescription.trim()) return;
    setRiskBusy(true);
    try {
      const res = await fetch(`/api/calculations/${calculation.id}/risks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: newRiskDescription, hours: newRiskHours }),
      });
      if (res.ok) {
        setNewRiskDescription("");
        setNewRiskHours(0);
        router.refresh();
      }
    } finally {
      setRiskBusy(false);
    }
  }

  async function updateRisk(risk: RiskRow, patch: { description?: string; hours?: number }) {
    setRiskBusy(true);
    try {
      await fetch(`/api/calculations/${calculation.id}/risks/${risk.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      router.refresh();
    } finally {
      setRiskBusy(false);
    }
  }

  async function removeRisk(risk: RiskRow) {
    setRiskBusy(true);
    try {
      await fetch(`/api/calculations/${calculation.id}/risks/${risk.id}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setRiskBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">{calculation.name}</h1>
          <p className="text-sm text-slate-500">
            Заказчик: {calculation.customer} · Шаблон: {calculation.template.name}
          </p>
        </div>
        <StatusBadge status={calculation.status} />
      </div>

      <div className="card p-6">
        <h2 className="mb-1 font-medium">Дата старта проекта</h2>
        <p className="mb-3 text-xs text-slate-500">
          Архитектор может менять дату старта даже если она зафиксирована шаблоном для пресейла. Изменение сдвигает
          весь график, сохраняя текущие трудозатраты этапов.
        </p>
        <div className="max-w-xs">
          <input
            type="date"
            className="input"
            disabled={locked}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <button className="btn-secondary mt-3" disabled={scheduleSaving || locked} onClick={saveSchedule}>
          {scheduleSaving ? "Сохранение…" : "Сохранить и пересчитать график"}
        </button>
      </div>

      <div className="card p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium">Этапы (без учёта авто-согласований)</h2>
          {!locked && (
            <button className="btn-secondary" onClick={addStage}>
              + Добавить этап
            </button>
          )}
        </div>
        <p className="mb-3 text-xs text-slate-500">
          Для этапов с исполнителем «консультант», «разработчик», «инженер» или «аналитик» система автоматически
          добавит задачу согласования на заказчика сроком 3 рабочих дня. РП в этапах не отображается — учитывается
          только в итоговых трудозатратах.
        </p>

        <div className="space-y-2">
          {stages.map((s, index) => (
            <div key={s.key} className="space-y-2 rounded-lg border border-slate-200 p-2 dark:border-nord-2">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="input flex-1 min-w-[180px]"
                  disabled={locked}
                  value={s.name}
                  onChange={(e) => updateStage(s.key, { name: e.target.value })}
                />
                <select
                  className="input w-44"
                  disabled={locked}
                  value={s.role}
                  onChange={(e) => updateStage(s.key, { role: e.target.value })}
                >
                  {ROLES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={0}
                  className="input w-28"
                  disabled={locked}
                  value={s.hours}
                  onChange={(e) => updateStage(s.key, { hours: e.target.valueAsNumber || 0 })}
                />
                <span className="text-xs text-slate-500">ч</span>
                {!locked && (
                  <div className="ml-auto flex gap-1">
                    <button className="btn-secondary px-2 py-1" onClick={() => moveStage(index, -1)} title="Вверх">
                      ↑
                    </button>
                    <button className="btn-secondary px-2 py-1" onClick={() => moveStage(index, 1)} title="Вниз">
                      ↓
                    </button>
                    <button
                      className="btn-secondary px-2 py-1 text-rose-600"
                      onClick={() => removeStage(s.key)}
                      title="Удалить"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
              <input
                className="input"
                placeholder="Требования и ограничения по этапу"
                disabled={locked}
                value={s.requirements}
                onChange={(e) => updateStage(s.key, { requirements: e.target.value })}
              />
            </div>
          ))}
          {stages.length === 0 && <p className="text-sm text-slate-500">Нет этапов. Добавьте хотя бы один.</p>}
        </div>

        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}

        <div className="mt-4 flex gap-3">
          <button className="btn-primary" disabled={saving || locked || stages.length === 0} onClick={save}>
            {saving ? "Сохранение…" : "Сохранить и пересчитать график"}
          </button>
          <button
            className="btn-secondary"
            disabled={saving || locked || calculation.status !== "pending_approval"}
            onClick={approve}
          >
            Утвердить расчёт
          </button>
        </div>
      </div>

      <div className="card p-6">
        <h2 className="mb-3 font-medium">Риски</h2>
        <div className="space-y-2">
          {calculation.risks.map((risk) => (
            <div key={risk.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2 dark:border-nord-2">
              <input
                className="input flex-1 min-w-[220px]"
                disabled={locked}
                defaultValue={risk.description}
                onBlur={(e) => e.target.value !== risk.description && updateRisk(risk, { description: e.target.value })}
              />
              <input
                type="number"
                min={0}
                className="input w-28"
                disabled={locked}
                defaultValue={risk.hours}
                onBlur={(e) => updateRisk(risk, { hours: e.target.valueAsNumber || 0 })}
              />
              <span className="text-xs text-slate-500">ч</span>
              {!locked && (
                <button
                  className="btn-secondary ml-auto px-2 py-1 text-rose-600"
                  onClick={() => removeRisk(risk)}
                  title="Удалить"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          {calculation.risks.length === 0 && <p className="text-sm text-slate-500">Риски не зафиксированы.</p>}
        </div>
        {!locked && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              className="input flex-1 min-w-[220px]"
              placeholder="Описание риска"
              value={newRiskDescription}
              onChange={(e) => setNewRiskDescription(e.target.value)}
            />
            <input
              type="number"
              min={0}
              className="input w-28"
              placeholder="ч"
              value={newRiskHours || ""}
              onChange={(e) => setNewRiskHours(e.target.valueAsNumber || 0)}
            />
            <button className="btn-secondary" disabled={riskBusy || !newRiskDescription.trim()} onClick={addRisk}>
              + Добавить риск
            </button>
          </div>
        )}
      </div>

      <div className="card p-5">
        <h2 className="mb-3 font-medium">Трудозатраты</h2>
        <TotalsSummary stages={calculation.stages} pmHours={calculation.pmHours} risks={calculation.risks} />
      </div>

      <div className="card p-5">
        <h2 className="mb-3 font-medium">Итоговый график</h2>
        <StageTable stages={calculation.stages} />
      </div>

      <div className="card p-5">
        <h2 className="mb-3 font-medium">Диаграмма Ганта</h2>
        <GanttChart stages={calculation.stages} />
      </div>
    </div>
  );
}
