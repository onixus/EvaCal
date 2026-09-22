'use client';

import Link from 'next/link';
import StatusBadge from '@/components/StatusBadge';
import type { SerializedCalculation } from './types';

export default function CalculationsTab({
  projectId,
  calculations,
  onCreateVersion,
}: {
  projectId: string;
  calculations: SerializedCalculation[];
  onCreateVersion: (calculation: SerializedCalculation) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-nord-6">
            История версий смет и расчётов
          </h2>
          <p className="text-xs text-slate-500 dark:text-nord-muted">
            Все ревизии трудозатрат проекта. Каждая версия сохраняет снимок этапов, рисков и
            параметров КП.
          </p>
        </div>
        <Link href={`/presale?projectId=${projectId}`} className="btn-secondary text-xs">
          + Создать расчёт с нуля
        </Link>
      </div>

      {calculations.length === 0 ? (
        <div className="card p-10 text-center">
          <h3 className="font-semibold text-slate-800 dark:text-nord-5">
            В этом проекте ещё нет расчётов
          </h3>
          <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto dark:text-nord-muted">
            Создайте первый расчёт трудозатрат через интерфейс пресейла.
          </p>
          <div className="mt-4">
            <Link href={`/presale?projectId=${projectId}`} className="btn-primary text-xs">
              Создать расчёт
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {calculations.map((calc, idx) => {
            const stageHours = calc.stages
              .filter((stage) => !stage.isApprovalTask)
              .reduce((sum, stage) => sum + stage.hours, 0);
            const riskHours = calc.risks.reduce((sum, risk) => sum + risk.hours, 0);
            const totalHours = stageHours + calc.pmHours + riskHours;
            const isLatest = idx === 0;

            return (
              <div
                key={calc.id}
                className={`card p-5 transition-all ${isLatest ? 'border-brand-200 shadow-sm dark:border-nord-frost4/40' : 'opacity-90 hover:opacity-100'}`}
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-slate-900 px-2.5 py-0.5 text-xs font-bold text-white dark:bg-nord-frost4 dark:text-nord-0">
                        v{calc.version}
                      </span>
                      <Link
                        href={`/calculations/${calc.id}`}
                        className="text-base font-bold text-slate-900 hover:text-brand-600 dark:text-nord-6 dark:hover:text-nord-frost2"
                      >
                        {calc.name}
                      </Link>
                      {isLatest && (
                        <span className="rounded bg-brand-50 px-2 py-0.5 text-[10px] font-bold text-brand-700 dark:bg-nord-3 dark:text-nord-frost3">
                          ТЕКУЩАЯ
                        </span>
                      )}
                      <StatusBadge status={calc.status} />
                    </div>

                    {calc.versionComment && (
                      <p className="text-xs text-slate-600 dark:text-nord-4 italic">
                        {calc.versionComment}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-nord-muted">
                      <span>
                        Шаблон:{' '}
                        <strong className="text-slate-700 dark:text-nord-4">
                          {calc.template.name}
                        </strong>
                      </span>
                      <span aria-hidden>·</span>
                      <span>Старт: {new Date(calc.startDate).toLocaleDateString('ru-RU')}</span>
                      <span aria-hidden>·</span>
                      <span>Обновлён: {new Date(calc.updatedAt).toLocaleDateString('ru-RU')}</span>
                      <span aria-hidden>·</span>
                      <span>Автор: {calc.createdBy}</span>
                    </div>
                  </div>

                  <div className="flex flex-col sm:items-end gap-2">
                    <div className="flex items-baseline gap-1">
                      <span className="text-2xl font-extrabold tabular-nums text-slate-900 dark:text-nord-6">
                        {totalHours}
                      </span>
                      <span className="text-xs font-medium text-slate-500">чел·ч</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-nord-muted">
                      <span>Этапы: {stageHours} ч</span>
                      <span>+</span>
                      <span>РП: {calc.pmHours} ч</span>
                      {riskHours > 0 && (
                        <>
                          <span>+</span>
                          <span className="text-amber-600 dark:text-nord-yellow">
                            Риски: {riskHours} ч
                          </span>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <Link href={`/calculations/${calc.id}`} className="btn-primary text-xs">
                        Хаб расчёта →
                      </Link>
                      <button
                        onClick={() => onCreateVersion(calc)}
                        className="btn-secondary text-xs"
                        title="Создать версию N+1 на основе этой сметы"
                      >
                        Новая версия
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
