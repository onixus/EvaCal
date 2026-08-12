'use client';

import type { TraceLink } from '@/lib/gost34/traceability/types';
import type { WizardReviewResult } from '@/lib/gost34/wizard/types';
import { PANEL_CLASS, SUBPANEL_CLASS } from '../wizardShared';

const METHOD_LABELS: Record<string, string> = {
  MANUAL: 'подтверждено вручную',
  RULE: 'предложено правилом',
  LLM: 'предложено ИИ',
};

interface TraceabilityStepProps {
  review: WizardReviewResult | null;
  isReviewLoading: boolean;
  manualLinks: TraceLink[];
  onManualLinksChange: (next: TraceLink[]) => void;
}

export default function TraceabilityStep({
  review,
  isReviewLoading,
  manualLinks,
  onManualLinksChange,
}: TraceabilityStepProps) {
  const requirements = review?.requirements || [];
  const stages = review?.stages || [];
  const links = review?.traceability.links || [];
  const metrics = review?.traceability.metrics;

  const linkFor = (requirementId: string) => links.find((link) => link.sourceId === requirementId);

  /**
   * Пустой этап — это осознанное решение «не распределять», а не отсутствие
   * решения: иначе следующий пересчёт снова навесил бы отклонённую связь по
   * правилу. Вернуть автоматическое предложение можно кнопкой «Сбросить».
   */
  const setManualLink = (requirementId: string, stageId: string) => {
    const rest = manualLinks.filter((link) => link.sourceId !== requirementId);
    onManualLinksChange([
      ...rest,
      {
        sourceId: requirementId,
        targetId: stageId,
        method: 'MANUAL',
        confidence: 1,
        approved: true,
      },
    ]);
  };

  const clearDecision = (requirementId: string) => {
    onManualLinksChange(manualLinks.filter((link) => link.sourceId !== requirementId));
  };

  const coverage = metrics?.coveragePercentage ?? 0;

  return (
    <div className="space-y-4 animate-in fade-in duration-150">
      <div className={`${PANEL_CLASS} space-y-3`}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-[#3b4252] pb-3">
          <div>
            <h4 className="text-sm font-bold text-blue-400 uppercase tracking-wider">
              🔗 Трассируемость требований
            </h4>
            <p className="text-xs text-slate-300 mt-1">
              Связь «требование → этап работ». Автоматические предложения помечаются и требуют
              подтверждения; непокрытые требования остаются видимыми как UNMAPPED.
            </p>
          </div>

          {metrics && (
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold">
              <span className="px-2.5 py-1 rounded-lg border bg-emerald-500/15 text-emerald-300 border-emerald-500/40">
                Покрытие: {coverage}%
              </span>
              <span className="px-2.5 py-1 rounded-lg border bg-slate-500/15 text-slate-300 border-slate-500/40">
                Связано: {metrics.mappedRequirements} из {metrics.totalRequirements}
              </span>
              {metrics.unmappedRequirements > 0 && (
                <span className="px-2.5 py-1 rounded-lg border bg-amber-500/15 text-amber-300 border-amber-500/40">
                  UNMAPPED: {metrics.unmappedRequirements}
                </span>
              )}
            </div>
          )}
        </div>

        {metrics && (
          <div className="h-2 w-full rounded-full bg-[#1c1f26] border border-[#3b4252] overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{ width: `${Math.min(100, Math.max(0, coverage))}%` }}
            />
          </div>
        )}

        {isReviewLoading && <div className="text-xs text-slate-400">Идёт расчёт трассировки…</div>}

        {!isReviewLoading && stages.length === 0 && (
          <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
            В расчёте нет этапов работ — связывать требования не с чем. Добавьте этапы в расчёт.
          </div>
        )}

        {!isReviewLoading && requirements.length === 0 && (
          <div className="text-xs text-slate-400 italic p-6 text-center border border-dashed border-[#434c5e] rounded-xl bg-[#1c1f26]">
            Требования не заданы: вернитесь на шаг «Требования».
          </div>
        )}

        {requirements.length > 0 && (
          <div className={`max-h-[26rem] overflow-y-auto ${SUBPANEL_CLASS}`}>
            <table className="w-full text-left text-xs">
              <thead className="bg-[#2e3440] text-white sticky top-0 border-b border-[#434c5e]">
                <tr>
                  <th className="p-3 w-32 font-bold text-blue-300">Код</th>
                  <th className="p-3 font-bold text-white">Требование</th>
                  <th className="p-3 w-64 font-bold text-slate-300">Этап работ</th>
                  <th className="p-3 w-40 font-bold text-slate-300">Статус связи</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2e3440]">
                {requirements.map((req) => {
                  const link = linkFor(req.id);
                  const isManual = manualLinks.some((m) => m.sourceId === req.id);

                  return (
                    <tr key={req.id} className="hover:bg-[#282c37] transition-colors align-top">
                      <td className="p-3 font-mono font-bold text-blue-400">{req.code}</td>
                      <td className="p-3 text-slate-100 break-words">
                        <div className="font-semibold text-white">{req.title}</div>
                        <div className="text-slate-400 text-[11px] mt-0.5 line-clamp-2">
                          {req.normalizedText || req.originalText}
                        </div>
                      </td>
                      <td className="p-3">
                        <select
                          value={link?.targetId || ''}
                          onChange={(e) => setManualLink(req.id, e.target.value)}
                          className="w-full bg-[#242832] border border-[#434c5e] rounded-lg px-2.5 py-1.5 text-white focus:border-blue-400 focus:outline-none"
                        >
                          <option value="">[НЕ РАСПРЕДЕЛЕНО]</option>
                          {stages.map((stage) => (
                            <option key={stage.id} value={stage.id}>
                              {stage.order}. {stage.name} — {stage.role}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="p-3 space-y-1.5">
                        {!link && (
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                              isManual
                                ? 'bg-slate-500/15 text-slate-300 border-slate-500/40'
                                : 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                            }`}
                          >
                            {isManual ? 'не распределено (решение)' : 'UNMAPPED'}
                          </span>
                        )}
                        {link && (
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                              link.approved
                                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                                : 'bg-blue-500/15 text-blue-300 border-blue-500/40'
                            }`}
                          >
                            {METHOD_LABELS[link.method] || link.method}
                            {typeof link.confidence === 'number' && !link.approved
                              ? ` • ${Math.round(link.confidence * 100)}%`
                              : ''}
                          </span>
                        )}
                        {link && !link.approved && (
                          <button
                            type="button"
                            onClick={() => setManualLink(req.id, link.targetId)}
                            className="block px-2 py-1 rounded-lg text-[11px] font-bold bg-[#2e3440] text-slate-200 border border-[#434c5e] hover:text-white"
                          >
                            ✓ Подтвердить связь
                          </button>
                        )}
                        {isManual && (
                          <button
                            type="button"
                            onClick={() => clearDecision(req.id)}
                            className="block px-2 py-1 rounded-lg text-[11px] font-bold text-slate-400 hover:text-white"
                          >
                            ↺ Сбросить решение
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
