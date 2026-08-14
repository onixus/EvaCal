'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  calculateScenarioVariations,
  ScenarioResult,
  ScenarioType,
} from '@/lib/scenarios';
import { formatCurrency } from '@/lib/commercial';
import { StageRow } from './StageTable';
import { RiskRow } from './TotalsSummary';

interface Props {
  calculationId: string;
  calculationName: string;
  stages: StageRow[];
  pmHours: number;
  risks: RiskRow[];
  currency?: string;
  roleRates?: string | null;
  overheadPercent?: number;
  marginPercent?: number;
  discountPercent?: number;
  vatPercent?: number;
  includeVat?: boolean;
}

export default function ScenarioAnalysisPanel({
  calculationId,
  calculationName,
  stages,
  pmHours,
  risks,
  currency = 'RUB',
  roleRates,
  overheadPercent = 0,
  marginPercent = 20,
  discountPercent = 0,
  vatPercent = 20,
  includeVat = true,
}: Props) {
  const router = useRouter();
  const [selectedScenario, setSelectedScenario] = useState<ScenarioType>('base');
  const [isCreatingVersion, setIsCreatingVersion] = useState(false);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const scenarioData = useMemo(() => {
    return calculateScenarioVariations(stages, pmHours, risks, {
      currency,
      roleRates,
      overheadPercent,
      marginPercent,
      discountPercent,
      vatPercent,
      includeVat,
    });
  }, [
    stages,
    pmHours,
    risks,
    currency,
    roleRates,
    overheadPercent,
    marginPercent,
    discountPercent,
    vatPercent,
    includeVat,
  ]);

  const activeResult: ScenarioResult = scenarioData[selectedScenario];

  const handleCreateVersionFromScenario = async () => {
    setIsCreatingVersion(true);
    setCreateError(null);
    setCreateSuccess(null);

    const comment = `Сценарий: ${activeResult.definition.label} (${
      activeResult.diffVsBase.hoursPercent >= 0 ? '+' : ''
    }${activeResult.diffVsBase.hoursPercent}% ч, ${formatCurrency(
      activeResult.commercial.grandTotal,
      currency,
    )})`;

    try {
      const res = await fetch(`/api/calculations/${calculationId}/version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          versionComment: comment,
          name: `${calculationName} (${activeResult.definition.shortLabel})`,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Ошибка создания версии расчета');
      }

      const created = await res.json();
      setCreateSuccess(`Создана новая версия v${created.version} для сценария «${activeResult.definition.shortLabel}»`);
      setTimeout(() => {
        router.refresh();
      }, 1500);
    } catch (err: any) {
      setCreateError(err?.message || 'Не удалось создать версию расчета');
    } finally {
      setIsCreatingVersion(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-nord-3 dark:bg-nord-1/60">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-nord-6">
              Сценарное моделирование трудозатрат и сметы (Scenario Planning)
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-nord-muted">
              Сравнение вариантов оценки для согласования с заказчиком и фиксация в версиях проекта
            </p>
          </div>

          <button
            onClick={handleCreateVersionFromScenario}
            disabled={isCreatingVersion}
            className="btn btn-primary text-xs font-semibold"
          >
            {isCreatingVersion
              ? 'Создание версии...'
              : `Сохранить «${activeResult.definition.shortLabel}» как v(N+1)`}
          </button>
        </div>

        {createSuccess && (
          <div className="mt-3 rounded-lg bg-emerald-50 p-2.5 text-xs font-medium text-emerald-800 dark:bg-nord-frost3/20 dark:text-nord-frost3">
            ✓ {createSuccess}
          </div>
        )}

        {createError && (
          <div className="mt-3 rounded-lg bg-rose-50 p-2.5 text-xs font-medium text-rose-800 dark:bg-nord-auroraRed/20 dark:text-nord-auroraRed">
            ⚠ {createError}
          </div>
        )}
      </div>

      {/* 4 Scenario Cards Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {scenarioData.all.map((item) => {
          const isSelected = selectedScenario === item.definition.type;
          const diffHours = item.diffVsBase.hours;
          const diffPct = item.diffVsBase.hoursPercent;

          return (
            <div
              key={item.definition.type}
              onClick={() => setSelectedScenario(item.definition.type)}
              className={`cursor-pointer rounded-xl border p-4 transition-all duration-200 ${
                isSelected
                  ? 'border-brand-500 bg-white shadow-md ring-2 ring-brand-500/20 dark:border-nord-frost2 dark:bg-nord-1 dark:ring-nord-frost2/30'
                  : 'border-slate-200/80 bg-slate-50/50 hover:border-slate-300 hover:bg-white dark:border-nord-3 dark:bg-nord-1/30 dark:hover:bg-nord-1/60'
              }`}
            >
              {/* Badge & Diff Pill */}
              <div className="flex items-center justify-between gap-1">
                <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${item.definition.badgeClass}`}>
                  {item.definition.shortLabel}
                </span>

                {item.definition.type !== 'base' && (
                  <span
                    className={`text-[10px] font-bold ${
                      diffHours < 0
                        ? 'text-emerald-600 dark:text-nord-frost3'
                        : 'text-amber-600 dark:text-nord-yellow'
                    }`}
                  >
                    {diffHours > 0 ? `+${diffHours} ч` : `${diffHours} ч`} ({diffPct > 0 ? `+${diffPct}%` : `${diffPct}%`})
                  </span>
                )}
              </div>

              {/* Hours */}
              <div className="mt-3">
                <div className="text-2xl font-black text-slate-900 dark:text-nord-6">
                  {item.totalLaborHours} <span className="text-xs font-normal text-slate-400">ч</span>
                </div>
                <div className="text-xs text-slate-400 dark:text-nord-muted">
                  ≈ {item.durationBusinessDays} раб. дн.
                </div>
              </div>

              {/* Budget */}
              <div className="mt-3 border-t border-slate-100 pt-2.5 dark:border-nord-3/60">
                <div className="text-sm font-bold text-slate-800 dark:text-nord-5">
                  {formatCurrency(item.commercial.grandTotal, item.commercial.currency)}
                </div>
                <div className="text-[11px] text-slate-400 dark:text-nord-muted">
                  {item.commercial.subtotalExVat > 0 ? `Без НДС: ${formatCurrency(item.commercial.subtotalExVat, item.commercial.currency)}` : ''}
                </div>
              </div>

              {/* Description preview */}
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500 dark:text-nord-muted">
                {item.definition.description}
              </p>
            </div>
          );
        })}
      </div>

      {/* Selected Scenario Detailed Overview */}
      <div className="card p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-3 dark:border-nord-3">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-nord-6">
              Детализация выбранного сценария: {activeResult.definition.label}
            </h3>
            <p className="text-xs text-slate-500 dark:text-nord-muted">
              {activeResult.definition.description}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-600 dark:text-nord-4">
              Разница с базовым:
            </span>
            <span
              className={`rounded-md px-2 py-0.5 text-xs font-bold ${
                activeResult.diffVsBase.hours <= 0
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-nord-frost3/20 dark:text-nord-frost3'
                  : 'bg-amber-100 text-amber-800 dark:bg-nord-yellow/20 dark:text-nord-yellow'
              }`}
            >
              {activeResult.diffVsBase.hours >= 0 ? '+' : ''}
              {activeResult.diffVsBase.hours} ч ({activeResult.diffVsBase.hoursPercent >= 0 ? '+' : ''}
              {activeResult.diffVsBase.hoursPercent}%) • {activeResult.diffVsBase.cost >= 0 ? '+' : ''}
              {formatCurrency(activeResult.diffVsBase.cost, currency)}
            </span>
          </div>
        </div>

        {/* Breakdown table */}
        <div className="mt-4 grid gap-6 md:grid-cols-3">
          {/* 1. Stages */}
          <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 dark:border-nord-3 dark:bg-nord-1/40">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-nord-muted">
              Этапы разработки
            </div>
            <div className="mt-2 text-xl font-bold text-slate-900 dark:text-nord-6">
              {activeResult.stagesHours} ч
            </div>
            <div className="mt-1 text-xs text-slate-400 dark:text-nord-muted">
              Коэффициент: ×{activeResult.definition.hoursMultiplier}
            </div>
          </div>

          {/* 2. PM */}
          <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 dark:border-nord-3 dark:bg-nord-1/40">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-nord-muted">
              Управление проектом (РП)
            </div>
            <div className="mt-2 text-xl font-bold text-slate-900 dark:text-nord-6">
              {activeResult.pmHours} ч
            </div>
            <div className="mt-1 text-xs text-slate-400 dark:text-nord-muted">
              Коэффициент: ×{activeResult.definition.pmAllowanceMultiplier}
            </div>
          </div>

          {/* 3. Risks */}
          <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 dark:border-nord-3 dark:bg-nord-1/40">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-nord-muted">
              Резерв на риски
            </div>
            <div className="mt-2 text-xl font-bold text-slate-900 dark:text-nord-6">
              {activeResult.riskHours} ч
            </div>
            <div className="mt-1 text-xs text-slate-400 dark:text-nord-muted">
              {activeResult.definition.includeRisks
                ? `Коэффициент: ×${activeResult.definition.riskMultiplier}`
                : 'Риски исключены'}
            </div>
          </div>
        </div>

        {/* Comparison Matrix Table */}
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:border-nord-3 dark:bg-nord-2 dark:text-nord-muted">
                <th className="px-3.5 py-2.5">Параметр</th>
                <th className="px-3.5 py-2.5 text-center">Оптимистичный</th>
                <th className="px-3.5 py-2.5 text-center font-bold text-slate-900 dark:text-nord-6">Базовый (Base)</th>
                <th className="px-3.5 py-2.5 text-center">С буфером рисков</th>
                <th className="px-3.5 py-2.5 text-center">Пессимистичный</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-nord-3/60">
              <tr>
                <td className="px-3.5 py-2.5 font-medium">Трудозатраты этапов</td>
                <td className="px-3.5 py-2.5 text-center">{scenarioData.optimistic.stagesHours} ч</td>
                <td className="px-3.5 py-2.5 text-center font-semibold">{scenarioData.base.stagesHours} ч</td>
                <td className="px-3.5 py-2.5 text-center">{scenarioData.risk_buffer.stagesHours} ч</td>
                <td className="px-3.5 py-2.5 text-center">{scenarioData.pessimistic.stagesHours} ч</td>
              </tr>
              <tr>
                <td className="px-3.5 py-2.5 font-medium">Управление (РП)</td>
                <td className="px-3.5 py-2.5 text-center">{scenarioData.optimistic.pmHours} ч</td>
                <td className="px-3.5 py-2.5 text-center font-semibold">{scenarioData.base.pmHours} ч</td>
                <td className="px-3.5 py-2.5 text-center">{scenarioData.risk_buffer.pmHours} ч</td>
                <td className="px-3.5 py-2.5 text-center">{scenarioData.pessimistic.pmHours} ч</td>
              </tr>
              <tr>
                <td className="px-3.5 py-2.5 font-medium">Резерв на риски</td>
                <td className="px-3.5 py-2.5 text-center text-slate-400">0 ч</td>
                <td className="px-3.5 py-2.5 text-center font-semibold">{scenarioData.base.riskHours} ч</td>
                <td className="px-3.5 py-2.5 text-center">{scenarioData.risk_buffer.riskHours} ч</td>
                <td className="px-3.5 py-2.5 text-center">{scenarioData.pessimistic.riskHours} ч</td>
              </tr>
              <tr className="bg-slate-50/50 font-bold dark:bg-nord-2/30">
                <td className="px-3.5 py-2.5">ИТОГО ТРУДОЕМКОСТЬ</td>
                <td className="px-3.5 py-2.5 text-center text-emerald-700 dark:text-nord-frost3">{scenarioData.optimistic.totalLaborHours} ч</td>
                <td className="px-3.5 py-2.5 text-center">{scenarioData.base.totalLaborHours} ч</td>
                <td className="px-3.5 py-2.5 text-center text-amber-700 dark:text-nord-yellow">{scenarioData.risk_buffer.totalLaborHours} ч</td>
                <td className="px-3.5 py-2.5 text-center text-rose-700 dark:text-nord-auroraRed">{scenarioData.pessimistic.totalLaborHours} ч</td>
              </tr>
              <tr className="font-bold">
                <td className="px-3.5 py-2.5">ИТОГО К ОПЛАТЕ</td>
                <td className="px-3.5 py-2.5 text-center text-emerald-700 dark:text-nord-frost3">{formatCurrency(scenarioData.optimistic.commercial.grandTotal, currency)}</td>
                <td className="px-3.5 py-2.5 text-center">{formatCurrency(scenarioData.base.commercial.grandTotal, currency)}</td>
                <td className="px-3.5 py-2.5 text-center text-amber-700 dark:text-nord-yellow">{formatCurrency(scenarioData.risk_buffer.commercial.grandTotal, currency)}</td>
                <td className="px-3.5 py-2.5 text-center text-rose-700 dark:text-nord-auroraRed">{formatCurrency(scenarioData.pessimistic.commercial.grandTotal, currency)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
