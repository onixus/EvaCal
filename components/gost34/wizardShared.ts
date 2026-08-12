import type { Gost34RequirementItem } from '@/lib/gost34/types';
import type { ApplicabilityOverride } from '@/lib/gost34/applicability/types';
import type { TraceLink } from '@/lib/gost34/traceability/types';
import type { WizardReviewResult, WizardStepStatus } from '@/lib/gost34/wizard/types';

/** Решения пользователя, которые мастер передаёт и в обзор, и в экспорт. */
export interface WizardDecisions {
  standardProfileId: string;
  layoutProfileId: string;
  docType: string;
  rawRequirements: Gost34RequirementItem[];
  applicabilityOverrides: Record<string, ApplicabilityOverride>;
  manualLinks: TraceLink[];
  signatures: Record<string, string>;
}

export interface WizardStepProps {
  decisions: WizardDecisions;
  review: WizardReviewResult | null;
  isReviewLoading: boolean;
  reviewError: string;
}

/** Цветовая схема индикатора шага: одна на вкладки, сводку и бейджи. */
export const STEP_STATUS_STYLES: Record<
  WizardStepStatus,
  { label: string; chip: string; dot: string }
> = {
  ready: {
    label: 'Готово',
    chip: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
    dot: 'bg-emerald-400',
  },
  attention: {
    label: 'Требует внимания',
    chip: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
    dot: 'bg-amber-400',
  },
  blocked: {
    label: 'Блокирует выпуск',
    chip: 'bg-red-500/15 text-red-300 border-red-500/40',
    dot: 'bg-red-400',
  },
  empty: {
    label: 'Не заполнено',
    chip: 'bg-slate-500/15 text-slate-300 border-slate-500/40',
    dot: 'bg-slate-400',
  },
};

export const APPLICABILITY_STATUS_STYLES: Record<string, { label: string; chip: string }> = {
  APPLICABLE: {
    label: 'Применимо',
    chip: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  },
  NOT_APPLICABLE: {
    label: 'Не применимо',
    chip: 'bg-slate-500/15 text-slate-300 border-slate-500/40',
  },
  UNKNOWN: {
    label: 'Требует подтверждения',
    chip: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  },
};

export const PANEL_CLASS = 'bg-[#242832] p-5 rounded-2xl border border-[#3b4252] shadow-md';
export const SUBPANEL_CLASS = 'bg-[#1c1f26] rounded-xl border border-[#3b4252]';
