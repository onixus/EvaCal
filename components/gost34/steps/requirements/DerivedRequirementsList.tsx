'use client';

import type { Gost34RequirementV2 } from '@/lib/gost34/requirements/v2';
import type { ValidationFinding } from '@/lib/gost34/validation/types';
import { PANEL_CLASS, SUBPANEL_CLASS } from '../../wizardShared';
import { SEVERITY_STYLES } from './ValidationSummaryPanel';

interface DerivedRequirementsListProps {
  derivedRequirements: Gost34RequirementV2[];
  findingsByCode: Map<string, ValidationFinding[]>;
}

export default function DerivedRequirementsList({
  derivedRequirements,
  findingsByCode,
}: DerivedRequirementsListProps) {
  if (derivedRequirements.length === 0) return null;

  return (
    <div className={`${PANEL_CLASS} space-y-3`}>
      <div>
        <h4 className="text-sm font-bold text-brand-700 dark:text-nord-frost2 uppercase tracking-wider">
          Требования из расчёта ({derivedRequirements.length})
        </h4>
        <p className="text-xs text-slate-600 dark:text-nord-4 mt-1">
          Собраны из поля «Требования» этапов работ. Правятся в самом расчёте, а не в мастере, но
          проверяются наравне с остальными.
        </p>
      </div>

      <div className={`${SUBPANEL_CLASS} divide-y divide-slate-100 dark:divide-nord-3`}>
        {derivedRequirements.map((req) => {
          const findings = findingsByCode.get(req.code) || [];
          return (
            <div key={req.id} className="p-3 space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono font-bold text-brand-700 dark:text-nord-frost2">
                  {req.code}
                </span>
                <span className="font-semibold text-slate-900 dark:text-nord-6">{req.title}</span>
                {req.source?.section && (
                  <span className="text-[10px] text-slate-500 dark:text-nord-muted">
                    источник: этап «{req.source.section}»
                  </span>
                )}
              </div>
              <div className="text-slate-600 dark:text-nord-4 text-[11px] leading-relaxed">
                {req.normalizedText || req.originalText}
              </div>
              {findings.map((finding, idx) => (
                <div
                  key={idx}
                  className={`text-[10px] rounded border px-2 py-1 ${SEVERITY_STYLES[finding.severity]}`}
                >
                  <span className="font-bold uppercase mr-1">{finding.rule}</span>
                  {finding.message}
                  {finding.severity === 'ERROR' && (
                    <span className="block mt-0.5 text-slate-600 dark:text-nord-4">
                      Исправьте формулировку в описании этапа расчёта.
                    </span>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
