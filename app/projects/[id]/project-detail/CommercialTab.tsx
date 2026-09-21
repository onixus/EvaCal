import Link from 'next/link';
import { calculateCommercialSummary, formatCurrency } from '@/lib/commercial';
import type { SerializedCalculation } from './types';

export default function CommercialTab({ calculation }: { calculation: SerializedCalculation | null }) {
  const commercial = calculation
    ? calculateCommercialSummary(calculation.stages, calculation.pmHours, calculation.risks, {
        currency: calculation.currency,
        roleRates: calculation.roleRates,
        overheadPercent: calculation.overheadPercent,
        marginPercent: calculation.marginPercent,
        discountPercent: calculation.discountPercent,
        vatPercent: calculation.vatPercent,
        includeVat: calculation.includeVat,
      })
    : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-nord-6">Коммерческая сводка проекта</h2>
          <p className="text-xs text-slate-500 dark:text-nord-muted">Финансовый расчёт стоимости, накладных расходов, маржи и налогов по текущей смете.</p>
        </div>
        {calculation && <Link href={`/calculations/${calculation.id}`} className="btn-secondary text-xs">Перейти к настройке ставок →</Link>}
      </div>

      {commercial ? (
        <div className="grid gap-6 md:grid-cols-2">
          <div className="card p-5 space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-nord-muted">Структура трудозатрат</h3>
            <div className="divide-y divide-slate-100 dark:divide-nord-3 text-sm">
              <div className="flex justify-between py-2"><span className="text-slate-600 dark:text-nord-4">Трудозатраты этапов</span><span className="font-bold">{commercial.stagesHours} ч</span></div>
              <div className="flex justify-between py-2"><span className="text-slate-600 dark:text-nord-4">Управление проектом (РП)</span><span className="font-bold">{commercial.pmHours} ч</span></div>
              <div className="flex justify-between py-2"><span className="text-slate-600 dark:text-nord-4">Рисковый резерв</span><span className="font-bold">{commercial.riskHours} ч</span></div>
              <div className="flex justify-between py-2.5 font-bold text-base bg-slate-50 px-2 rounded dark:bg-nord-1"><span>Всего трудозатрат</span><span className="text-brand-700 dark:text-nord-frost2">{commercial.directLaborHours} ч</span></div>
            </div>
          </div>

          <div className="card p-5 space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-nord-muted">Финансовая калькуляция</h3>
            <div className="divide-y divide-slate-100 dark:divide-nord-3 text-sm">
              <div className="flex justify-between py-2"><span className="text-slate-600 dark:text-nord-4">Себестоимость труда</span><span className="font-bold font-mono">{formatCurrency(commercial.directLaborCost, commercial.currency)}</span></div>
              <div className="flex justify-between py-2"><span className="text-slate-600 dark:text-nord-4">Накладные расходы ({commercial.overheadPercent}%)</span><span className="font-mono">{formatCurrency(commercial.overheadAmount, commercial.currency)}</span></div>
              <div className="flex justify-between py-2"><span className="text-slate-600 dark:text-nord-4">Плановая маржа ({commercial.marginPercent}%)</span><span className="font-mono text-emerald-600 dark:text-nord-green">+{formatCurrency(commercial.marginAmount, commercial.currency)}</span></div>
              {commercial.discountPercent > 0 && <div className="flex justify-between py-2 text-rose-600 dark:text-nord-redText"><span>Скидка ({commercial.discountPercent}%)</span><span className="font-mono">-{formatCurrency(commercial.discountAmount, commercial.currency)}</span></div>}
              {commercial.vatAmount > 0 && <div className="flex justify-between py-2"><span className="text-slate-600 dark:text-nord-4">НДС ({commercial.vatPercent}%)</span><span className="font-mono">{formatCurrency(commercial.vatAmount, commercial.currency)}</span></div>}
              <div className="flex justify-between py-3 font-extrabold text-lg bg-emerald-50 px-3 rounded text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"><span>Итоговое КП для заказчика</span><span className="font-mono">{formatCurrency(commercial.grandTotal, commercial.currency)}</span></div>
            </div>
          </div>
        </div>
      ) : (
        <div className="card p-8 text-center text-slate-500">Нет данных расчёта для формирования коммерческой сводки.</div>
      )}
    </div>
  );
}
