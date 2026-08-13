'use client';

import type { WizardReviewResult } from '@/lib/gost34/wizard/types';
import type { ValidationFinding } from '@/lib/gost34/validation/types';
import { PANEL_CLASS } from '../../wizardShared';

export const SEVERITY_STYLES: Record<string, string> = {
  ERROR: 'bg-red-500/15 text-red-300 border-red-500/40',
  WARNING: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  INFO: 'bg-slate-500/15 text-slate-300 border-slate-500/40',
};

interface ValidationSummaryPanelProps {
  review: WizardReviewResult | null;
  isReviewLoading: boolean;
}

export default function ValidationSummaryPanel({
  review,
  isReviewLoading,
}: ValidationSummaryPanelProps) {
  const counts = review?.validation.counts;
  const summaryFindings = (review?.validation.byRequirement?.[''] || []) as ValidationFinding[];

  return (
    <div className={`${PANEL_CLASS} space-y-3`}>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 border-b border-[#3b4252] pb-3">
        <div>
          <h4 className="text-sm font-bold text-blue-400 uppercase tracking-wider">
            Проверка формулировок (ГОСТ 34.602)
          </h4>
          <p className="text-xs text-slate-300 mt-1">
            Единичность, однозначность, измеримость, проверяемость и наличие источника
          </p>
        </div>
        {counts && (
          <div className="flex items-center gap-2 text-[11px] font-bold">
            {(['ERROR', 'WARNING', 'INFO'] as const).map((severity) => (
              <span
                key={severity}
                className={`px-2.5 py-1 rounded-lg border ${SEVERITY_STYLES[severity]}`}
              >
                {severity}: {counts[severity] || 0}
              </span>
            ))}
          </div>
        )}
      </div>

      {isReviewLoading && <div className="text-xs text-slate-400">Идёт проверка требований…</div>}

      {!isReviewLoading && summaryFindings.length > 0 && (
        <ul className="space-y-1.5">
          {summaryFindings.map((finding, idx) => (
            <li
              key={idx}
              className={`text-[11px] rounded-lg border px-3 py-2 ${SEVERITY_STYLES[finding.severity]}`}
            >
              <span className="font-bold uppercase mr-2">{finding.rule}</span>
              {finding.message}
            </li>
          ))}
        </ul>
      )}

      {!isReviewLoading && review && review.validation.findings.length === 0 && (
        <div className="text-xs text-emerald-300">Замечаний к формулировкам нет.</div>
      )}
    </div>
  );
}
