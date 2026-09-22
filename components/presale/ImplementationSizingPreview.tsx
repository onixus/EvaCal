'use client';

import type { ImplementationSizing } from '@/lib/presets/implementationSizing';

export type ImplementationSizingPreviewData = Omit<ImplementationSizing, 'gostRequirements'>;

export default function ImplementationSizingPreview({
  sizing,
}: {
  sizing: ImplementationSizingPreviewData;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-4 dark:border-nord-frost4/30 dark:bg-nord-3/40">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-brand-700 dark:text-nord-frost3">
              Автоматический sizing · {sizing.label}
            </div>
            <div className="mt-1 text-sm font-bold text-slate-900 dark:text-nord-6">
              {sizing.summary}
            </div>
          </div>
          <span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold uppercase text-slate-500 shadow-sm dark:bg-nord-2 dark:text-nord-4">
            проектная оценка
          </span>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {sizing.metrics.map((metric) => (
            <div key={metric.key} className="rounded-lg bg-white p-2.5 dark:bg-nord-2">
              <div className="text-[9px] font-semibold uppercase tracking-wide text-slate-400 dark:text-nord-muted">
                {metric.label}
              </div>
              <div className="nums mt-0.5 text-base font-extrabold text-slate-900 dark:text-nord-6">
                {metric.value}
                {metric.unit ? (
                  <span className="ml-1 text-[10px] font-semibold text-slate-500 dark:text-nord-muted">
                    {metric.unit}
                  </span>
                ) : null}
              </div>
              <div className="mt-1 text-[9px] leading-snug text-slate-400 dark:text-nord-muted">
                {metric.basis}
              </div>
            </div>
          ))}
        </div>

        {sizing.warnings.length > 0 && (
          <div className="mt-3 space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-2.5 dark:border-nord-yellow/30 dark:bg-nord-yellow/10">
            {sizing.warnings.map((warning) => (
              <div
                key={warning}
                className="text-[10px] leading-relaxed text-amber-900 dark:text-nord-yellow"
              >
                • {warning}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="card-flat p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-nord-muted">
            Типовой состав ТЗ
          </div>
          <div className="mt-2 space-y-3">
            {sizing.tzSections.map((section) => (
              <div key={section.code}>
                <div className="text-xs font-bold text-slate-800 dark:text-nord-5">
                  {section.code} · {section.title}
                </div>
                <ul className="mt-1 space-y-0.5 text-[10px] leading-relaxed text-slate-600 dark:text-nord-4">
                  {section.items.map((item) => (
                    <li key={item}>• {item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="card-flat p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-nord-muted">
            Типовой состав ПМИ
          </div>
          <div className="mt-2 space-y-3">
            {sizing.pmiScenarios.map((scenario) => (
              <div key={scenario.code} className="rounded-lg bg-slate-50 p-2.5 dark:bg-nord-1">
                <div className="text-xs font-bold text-slate-800 dark:text-nord-5">
                  {scenario.code} · {scenario.title}
                </div>
                <div className="mt-1 text-[10px] leading-relaxed text-slate-500 dark:text-nord-muted">
                  <strong>Метод:</strong> {scenario.method}
                </div>
                <div className="mt-0.5 text-[10px] leading-relaxed text-slate-600 dark:text-nord-4">
                  <strong>Критерий:</strong> {scenario.expectedResult}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="text-[10px] leading-relaxed text-slate-400 dark:text-nord-muted">
        Sizing используется как пресейл-оценка и вход в ТЗ/ПМИ. Финальный BOM и лицензирование
        подтверждаются по методике выбранного вендора после обследования или пилота.
      </p>
    </div>
  );
}
