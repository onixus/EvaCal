'use client';

import { useState, useMemo } from 'react';
import {
  calculateCommercialSummary,
  formatCurrency,
  resolveRoleRates,
  SUPPORTED_CURRENCIES,
  DEFAULT_ROLE_RATES,
} from '@/lib/commercial';
import { ROLES, roleLabel } from '@/lib/roles';
import { StageRow } from './StageTable';
import { RiskRow } from './TotalsSummary';

interface Props {
  calculationId: string;
  stages: StageRow[];
  pmHours: number;
  risks: RiskRow[];
  initialCurrency?: string;
  initialRoleRates?: string | null;
  initialOverheadPercent?: number;
  initialMarginPercent?: number;
  initialDiscountPercent?: number;
  initialVatPercent?: number;
  initialIncludeVat?: boolean;
  canEdit?: boolean;
}

export default function CommercialProposalPanel({
  calculationId,
  stages,
  pmHours,
  risks,
  initialCurrency = 'RUB',
  initialRoleRates,
  initialOverheadPercent = 0,
  initialMarginPercent = 20,
  initialDiscountPercent = 0,
  initialVatPercent = 20,
  initialIncludeVat = true,
  canEdit = true,
}: Props) {
  const [currency, setCurrency] = useState(initialCurrency);
  const [roleRates, setRoleRates] = useState<Record<string, number>>(() =>
    resolveRoleRates(initialRoleRates),
  );
  const [overheadPercent, setOverheadPercent] = useState<number>(initialOverheadPercent);
  const [marginPercent, setMarginPercent] = useState<number>(initialMarginPercent);
  const [discountPercent, setDiscountPercent] = useState<number>(initialDiscountPercent);
  const [vatPercent, setVatPercent] = useState<number>(initialVatPercent);
  const [includeVat, setIncludeVat] = useState<boolean>(initialIncludeVat);

  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const summary = useMemo(() => {
    return calculateCommercialSummary(stages, pmHours, risks, {
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

  const handleRateChange = (roleKey: string, valueStr: string) => {
    const num = Number.parseInt(valueStr, 10);
    setRoleRates((prev) => ({
      ...prev,
      [roleKey]: Number.isFinite(num) && num >= 0 ? num : 0,
    }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const res = await fetch(`/api/calculations/${calculationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currency,
          roleRates,
          overheadPercent,
          marginPercent,
          discountPercent,
          vatPercent,
          includeVat,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Ошибка при сохранении коммерческих параметров');
      }

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      setSaveError(err?.message || 'Не удалось сохранить смету');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Financial KPI Metrics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* 1. Прямая себестоимость */}
        <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-nord-3 dark:bg-nord-1/60">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-nord-muted">
            Себестоимость труда
          </div>
          <div className="mt-2 text-xl font-bold text-slate-900 dark:text-nord-6 sm:text-2xl">
            {formatCurrency(summary.directLaborCost, summary.currency)}
          </div>
          <div className="mt-1 text-xs text-slate-400 dark:text-nord-muted">
            {summary.directLaborHours} ч • ср. {formatCurrency(summary.directLaborHours > 0 ? Math.round(summary.directLaborCost / summary.directLaborHours) : 0, summary.currency)}/ч
          </div>
        </div>

        {/* 2. Накладные и Полная себестоимость */}
        <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-nord-3 dark:bg-nord-1/60">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-nord-muted">
              Полная себестоимость
            </span>
            {summary.overheadPercent > 0 && (
              <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-nord-yellow/20 dark:text-nord-yellow">
                +{summary.overheadPercent}% накладные
              </span>
            )}
          </div>
          <div className="mt-2 text-xl font-bold text-slate-900 dark:text-nord-6 sm:text-2xl">
            {formatCurrency(summary.totalCost, summary.currency)}
          </div>
          <div className="mt-1 text-xs text-slate-400 dark:text-nord-muted">
            Накладные: {formatCurrency(summary.overheadAmount, summary.currency)}
          </div>
        </div>

        {/* 3. Маржа / Прибыль */}
        <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/40 p-4 shadow-sm dark:border-nord-frost3/40 dark:bg-nord-1/60">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-800 dark:text-nord-frost3">
              Маржа / Прибыль
            </span>
            <span className="rounded-md bg-emerald-200/80 px-1.5 py-0.5 text-[10px] font-bold text-emerald-900 dark:bg-nord-frost3/20 dark:text-nord-frost3">
              {summary.marginPercent}%
            </span>
          </div>
          <div className="mt-2 text-xl font-bold text-emerald-950 dark:text-nord-frost3 sm:text-2xl">
            +{formatCurrency(summary.marginAmount, summary.currency)}
          </div>
          <div className="mt-1 text-xs text-emerald-700/80 dark:text-nord-muted">
            Эффект. ставка: {formatCurrency(summary.blendedHourlyRate, summary.currency)}/ч
          </div>
        </div>

        {/* 4. Итоговая сумма к оплате */}
        <div className="rounded-xl border border-sky-300 bg-gradient-to-br from-sky-50 to-indigo-50/50 p-4 shadow-sm dark:border-nord-frost2/40 dark:from-nord-1 dark:to-nord-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-sky-900 dark:text-nord-frost2">
              Итого к оплате
            </span>
            {includeVat ? (
              <span className="rounded-md bg-sky-200/80 px-1.5 py-0.5 text-[10px] font-bold text-sky-900 dark:bg-nord-frost2/20 dark:text-nord-frost2">
                с НДС {summary.vatPercent}%
              </span>
            ) : (
              <span className="rounded-md bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 dark:bg-nord-3 dark:text-nord-4">
                без НДС
              </span>
            )}
          </div>
          <div className="mt-2 text-xl font-extrabold text-sky-950 dark:text-nord-6 sm:text-2xl">
            {formatCurrency(summary.grandTotal, summary.currency)}
          </div>
          <div className="mt-1 text-xs text-sky-800/80 dark:text-nord-muted">
            Без НДС: {formatCurrency(summary.subtotalExVat, summary.currency)}
          </div>
        </div>
      </div>

      {/* Main Grid: Role Rates & Commercial Multipliers */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left column: Role Rates Breakdown */}
        <div className="space-y-4 lg:col-span-7">
          <div className="card p-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-nord-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-nord-6">
                  1. Трудозатраты и ставки по ролям
                </h2>
                <p className="text-xs text-slate-500 dark:text-nord-muted">
                  Укажите почасовые ставки специалистов для расчета себестоимости сметы
                </p>
              </div>
              <span className="text-xs font-semibold text-slate-600 dark:text-nord-4">
                {summary.directLaborHours} ч всего
              </span>
            </div>

            <div className="mt-4 divide-y divide-slate-100 overflow-hidden dark:divide-nord-3/60">
              {summary.rolesBreakdown.map((r) => (
                <div
                  key={r.role}
                  className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="space-y-0.5 sm:w-1/3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-800 dark:text-nord-5">
                        {r.roleLabel}
                      </span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600 dark:bg-nord-2 dark:text-nord-muted">
                        {r.hours} ч
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 dark:text-nord-muted">
                      Доля: {r.sharePercent}% бюджета
                    </div>
                  </div>

                  <div className="flex items-center gap-3 sm:w-2/3 sm:justify-end">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-slate-500 dark:text-nord-muted">Ставка:</span>
                      <input
                        type="number"
                        min="0"
                        step="100"
                        disabled={!canEdit}
                        value={roleRates[r.role] ?? DEFAULT_ROLE_RATES[r.role] ?? 3500}
                        onChange={(e) => handleRateChange(r.role, e.target.value)}
                        className="input h-8 w-24 text-right text-xs font-semibold"
                      />
                      <span className="text-xs text-slate-500 dark:text-nord-muted">
                        {summary.currencySymbol}/ч
                      </span>
                    </div>

                    <div className="w-28 text-right text-sm font-bold text-slate-900 dark:text-nord-6">
                      {formatCurrency(r.cost, summary.currency)}
                    </div>
                  </div>
                </div>
              ))}

              {/* PM row */}
              {summary.pmHours > 0 && (
                <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-0.5 sm:w-1/3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-800 dark:text-nord-5">
                        Управление (РП)
                      </span>
                      <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700 dark:bg-nord-purple/20 dark:text-nord-purple">
                        {summary.pmHours} ч
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 dark:text-nord-muted">
                      Администрирование проекта
                    </div>
                  </div>

                  <div className="flex items-center gap-3 sm:w-2/3 sm:justify-end">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-slate-500 dark:text-nord-muted">Ставка:</span>
                      <input
                        type="number"
                        min="0"
                        step="100"
                        disabled={!canEdit}
                        value={roleRates.pm ?? DEFAULT_ROLE_RATES.pm ?? 4500}
                        onChange={(e) => handleRateChange('pm', e.target.value)}
                        className="input h-8 w-24 text-right text-xs font-semibold"
                      />
                      <span className="text-xs text-slate-500 dark:text-nord-muted">
                        {summary.currencySymbol}/ч
                      </span>
                    </div>

                    <div className="w-28 text-right text-sm font-bold text-slate-900 dark:text-nord-6">
                      {formatCurrency(summary.pmCost, summary.currency)}
                    </div>
                  </div>
                </div>
              )}

              {/* Risk allowance row */}
              {summary.riskHours > 0 && (
                <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-0.5 sm:w-1/3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-800 dark:text-nord-5">
                        Резерв на риски
                      </span>
                      <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[11px] font-semibold text-rose-700 dark:bg-nord-auroraRed/20 dark:text-nord-auroraRed">
                        {summary.riskHours} ч
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 dark:text-nord-muted">
                      По средневзвешенной ставке
                    </div>
                  </div>

                  <div className="flex items-center gap-3 sm:w-2/3 sm:justify-end">
                    <span className="text-xs text-slate-400 dark:text-nord-muted">
                      ≈ {formatCurrency(Math.round(summary.riskCost / summary.riskHours), summary.currency)}/ч
                    </span>
                    <div className="w-28 text-right text-sm font-bold text-slate-900 dark:text-nord-6">
                      {formatCurrency(summary.riskCost, summary.currency)}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right column: Financial Multipliers & Controls */}
        <div className="space-y-4 lg:col-span-5">
          <div className="card p-5">
            <h2 className="border-b border-slate-100 pb-3 text-base font-semibold text-slate-900 dark:border-nord-3 dark:text-nord-6">
              2. Финансовые параметры и маржа
            </h2>

            <div className="mt-4 space-y-4">
              {/* Currency selector */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-nord-4">
                  Валюта расчёта
                </label>
                <select
                  disabled={!canEdit}
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="input mt-1 w-full text-xs"
                >
                  {Object.values(SUPPORTED_CURRENCIES).map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Overhead percentage */}
              <div>
                <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-nord-4">
                  <span>Накладные расходы (Overhead)</span>
                  <span className="text-slate-900 dark:text-nord-6">{overheadPercent}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="40"
                  step="1"
                  disabled={!canEdit}
                  value={overheadPercent}
                  onChange={(e) => setOverheadPercent(Number(e.target.value))}
                  className="mt-1.5 w-full accent-indigo-600"
                />
                <div className="flex justify-between text-[10px] text-slate-400 dark:text-nord-muted">
                  <span>0%</span>
                  <span>+{formatCurrency(summary.overheadAmount, summary.currency)}</span>
                  <span>40%</span>
                </div>
              </div>

              {/* Margin percentage */}
              <div>
                <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-nord-4">
                  <span>Плановая норма маржи (Прибыль)</span>
                  <span className="font-bold text-emerald-600 dark:text-nord-frost3">
                    {marginPercent}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="60"
                  step="1"
                  disabled={!canEdit}
                  value={marginPercent}
                  onChange={(e) => setMarginPercent(Number(e.target.value))}
                  className="mt-1.5 w-full accent-emerald-600"
                />
                <div className="flex justify-between text-[10px] text-slate-400 dark:text-nord-muted">
                  <span>0%</span>
                  <span>+{formatCurrency(summary.marginAmount, summary.currency)}</span>
                  <span>60%</span>
                </div>
              </div>

              {/* Discount percentage */}
              <div>
                <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-nord-4">
                  <span>Скидка заказчику</span>
                  <span className="text-rose-600 dark:text-nord-auroraRed">
                    {discountPercent > 0 ? `-${discountPercent}%` : '0%'}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="30"
                  step="1"
                  disabled={!canEdit}
                  value={discountPercent}
                  onChange={(e) => setDiscountPercent(Number(e.target.value))}
                  className="mt-1.5 w-full accent-rose-500"
                />
                {discountPercent > 0 && (
                  <div className="text-right text-[10px] text-rose-500">
                    -{formatCurrency(summary.discountAmount, summary.currency)}
                  </div>
                )}
              </div>

              {/* VAT Switch & Rate */}
              <div className="border-t border-slate-100 pt-3 dark:border-nord-3">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-nord-4">
                    <input
                      type="checkbox"
                      disabled={!canEdit}
                      checked={includeVat}
                      onChange={(e) => setIncludeVat(e.target.checked)}
                      className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                    />
                    <span>НДС ({vatPercent}%) включён в итоговую цену</span>
                  </label>
                  {includeVat && (
                    <input
                      type="number"
                      min="0"
                      max="30"
                      disabled={!canEdit}
                      value={vatPercent}
                      onChange={(e) => setVatPercent(Number(e.target.value))}
                      className="input h-7 w-16 text-right text-xs"
                    />
                  )}
                </div>
              </div>

              {/* Save / Feedback State */}
              {canEdit && (
                <div className="pt-2">
                  <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="btn btn-primary w-full justify-center text-xs font-semibold"
                  >
                    {isSaving ? 'Сохранение...' : 'Сохранить параметры сметы'}
                  </button>

                  {saveSuccess && (
                    <div className="mt-2 text-center text-xs font-medium text-emerald-600 dark:text-nord-frost3">
                      ✓ Параметры сметы успешно сохранены
                    </div>
                  )}

                  {saveError && (
                    <div className="mt-2 text-center text-xs font-medium text-rose-600 dark:text-nord-auroraRed">
                      {saveError}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
