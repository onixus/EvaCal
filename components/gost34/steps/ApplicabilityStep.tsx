'use client';

import { useState } from 'react';
import type { ApplicabilityOverride, ApplicabilityResult } from '@/lib/gost34/applicability/types';
import type { WizardReviewResult } from '@/lib/gost34/wizard/types';
import { APPLICABILITY_STATUS_STYLES, PANEL_CLASS, SUBPANEL_CLASS } from '../wizardShared';

const CATEGORY_LABELS: Record<string, string> = {
  security: 'Информационная безопасность',
  regulatory: 'Регуляторные требования',
  technical: 'Технические требования',
  reliability: 'Надёжность и непрерывность',
  ergonomics: 'Эргономика и доступность',
};

interface ApplicabilityStepProps {
  review: WizardReviewResult | null;
  isReviewLoading: boolean;
  overrides: Record<string, ApplicabilityOverride>;
  onOverridesChange: (next: Record<string, ApplicabilityOverride>) => void;
  /** ФИО ответственного из шага реквизитов — попадает в поле «кто подтвердил». */
  confirmedBy: string;
}

export default function ApplicabilityStep({
  review,
  isReviewLoading,
  overrides,
  onOverridesChange,
  confirmedBy,
}: ApplicabilityStepProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [statusFilter, setStatusFilter] = useState<'all' | 'UNKNOWN' | 'APPLICABLE'>('all');

  const results = review?.applicability.results || [];
  const summary = review?.applicability.summary;

  const setOverride = (standardId: string, status: 'APPLICABLE' | 'NOT_APPLICABLE') => {
    onOverridesChange({
      ...overrides,
      [standardId]: {
        status,
        confirmedBy: confirmedBy || 'Ответственный не указан',
        reason:
          status === 'APPLICABLE'
            ? 'Применимость подтверждена вручную'
            : 'Норматив признан неприменимым вручную',
      },
    });
  };

  const clearOverride = (standardId: string) => {
    const next = { ...overrides };
    delete next[standardId];
    onOverridesChange(next);
  };

  const visible = results.filter((item) =>
    statusFilter === 'all' ? true : item.finalStatus === statusFilter,
  );

  return (
    <div className="space-y-4 animate-in fade-in duration-150">
      <div className={`${PANEL_CLASS} space-y-3`}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-[#3b4252] pb-3">
          <div>
            <h4 className="text-sm font-bold text-blue-400 uppercase tracking-wider">
              🛡️ Применимость нормативных требований
            </h4>
            <p className="text-xs text-slate-300 mt-1">
              Статус рассчитан по проектному контексту. Ни один норматив не включается автоматически
              без основания; статус «Требует подтверждения» допустим и не блокирует выпуск.
            </p>
          </div>

          {summary && (
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold">
              <span className="px-2.5 py-1 rounded-lg border bg-emerald-500/15 text-emerald-300 border-emerald-500/40">
                Применимо: {summary.applicable}
              </span>
              <span className="px-2.5 py-1 rounded-lg border bg-amber-500/15 text-amber-300 border-amber-500/40">
                Требует подтверждения: {summary.unknown}
              </span>
              <span className="px-2.5 py-1 rounded-lg border bg-slate-500/15 text-slate-300 border-slate-500/40">
                Не применимо: {summary.notApplicable}
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { id: 'all', label: 'Все нормативы' },
              { id: 'UNKNOWN', label: 'Требуют подтверждения' },
              { id: 'APPLICABLE', label: 'Применимые' },
            ] as const
          ).map((filter) => (
            <button
              key={filter.id}
              type="button"
              onClick={() => setStatusFilter(filter.id)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${
                statusFilter === filter.id
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-[#1c1f26] text-slate-300 hover:bg-[#2e3440] border border-[#3b4252]'
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>

        {isReviewLoading && (
          <div className="text-xs text-slate-400">Идёт оценка применимости нормативов…</div>
        )}

        {!isReviewLoading && visible.length === 0 && (
          <div className="text-xs text-slate-400 italic p-6 text-center border border-dashed border-[#434c5e] rounded-xl bg-[#1c1f26]">
            Нормативы с выбранным статусом отсутствуют.
          </div>
        )}

        <div className="space-y-2">
          {visible.map((item: ApplicabilityResult) => {
            const style = APPLICABILITY_STATUS_STYLES[item.finalStatus];
            const isOpen = Boolean(expanded[item.standardId]);
            const isOverridden = Boolean(overrides[item.standardId]);

            return (
              <div key={item.standardId} className={`${SUBPANEL_CLASS} p-3.5 space-y-2`}>
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm text-white">{item.title}</span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold border ${style.chip}`}
                      >
                        {style.label}
                      </span>
                      {isOverridden && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold border bg-blue-500/15 text-blue-300 border-blue-500/40">
                          ручное решение
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      {CATEGORY_LABELS[item.category] || item.category}
                      {typeof item.confidence === 'number' && (
                        <> • уверенность движка {Math.round(item.confidence * 100)}%</>
                      )}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setOverride(item.standardId, 'APPLICABLE')}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors ${
                        overrides[item.standardId]?.status === 'APPLICABLE'
                          ? 'bg-emerald-600 text-white border-emerald-400'
                          : 'bg-[#2e3440] text-slate-300 border-[#434c5e] hover:text-white'
                      }`}
                    >
                      Применимо
                    </button>
                    <button
                      type="button"
                      onClick={() => setOverride(item.standardId, 'NOT_APPLICABLE')}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors ${
                        overrides[item.standardId]?.status === 'NOT_APPLICABLE'
                          ? 'bg-slate-600 text-white border-slate-400'
                          : 'bg-[#2e3440] text-slate-300 border-[#434c5e] hover:text-white'
                      }`}
                    >
                      Не применимо
                    </button>
                    {isOverridden && (
                      <button
                        type="button"
                        onClick={() => clearOverride(item.standardId)}
                        className="px-2 py-1 rounded-lg text-[11px] font-bold text-slate-400 hover:text-white"
                        title="Вернуть решение движка"
                      >
                        ↺
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        setExpanded((prev) => ({ ...prev, [item.standardId]: !isOpen }))
                      }
                      className="px-2 py-1 rounded-lg text-[11px] font-bold text-blue-300 hover:text-blue-200"
                    >
                      {isOpen ? 'Скрыть' : 'Основание'}
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div className="space-y-2 pt-2 border-t border-[#3b4252]">
                    <div>
                      <div className="text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-1">
                        Причины решения
                      </div>
                      <ul className="space-y-1">
                        {item.reasons.map((reason, idx) => (
                          <li key={idx} className="text-[11px] text-slate-300 leading-relaxed">
                            • {reason}
                          </li>
                        ))}
                      </ul>
                    </div>

                    {item.evidence.length > 0 && (
                      <div>
                        <div className="text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-1">
                          Факты из проектного контекста
                        </div>
                        <ul className="space-y-1">
                          {item.evidence.map((evidence, idx) => (
                            <li key={idx} className="text-[11px] text-slate-400 leading-relaxed">
                              <span className="font-mono text-blue-300">{evidence.source}</span> —{' '}
                              {evidence.details}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {item.calculatedStatus !== item.finalStatus && (
                      <div className="text-[11px] text-amber-300">
                        Решение движка: {APPLICABILITY_STATUS_STYLES[item.calculatedStatus].label} —
                        переопределено вручную
                        {item.confirmedBy ? ` (${item.confirmedBy})` : ''}.
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
