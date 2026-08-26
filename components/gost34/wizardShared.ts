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
  sectionOverrides?: Record<string, { title?: string; paragraphs?: string[] }>;
}

export interface WizardStepProps {
  decisions: WizardDecisions;
  review: WizardReviewResult | null;
  isReviewLoading: boolean;
  reviewError: string;
}

/**
 * Цветовая схема индикатора шага: одна на рельс студии, сводку и бейджи.
 *
 * `label` — подпись под названием шага в рельсе, поэтому формулировки короткие
 * и в нижнем регистре: они читаются как состояние, а не как заголовок.
 */
export const STEP_STATUS_STYLES: Record<
  WizardStepStatus,
  { label: string; chip: string; dot: string; text: string }
> = {
  ready: {
    label: 'готово',
    chip: 'chip-ok',
    dot: 'bg-emerald-500 dark:bg-nord-green',
    text: 'text-slate-400 dark:text-nord-muted',
  },
  attention: {
    label: 'есть замечания',
    chip: 'chip-warn',
    dot: 'bg-amber-500 dark:bg-nord-yellow',
    text: 'text-amber-700 dark:text-nord-yellow',
  },
  blocked: {
    label: 'блокирует выпуск',
    chip: 'chip-block',
    dot: 'bg-rose-500 dark:bg-nord-red',
    text: 'text-rose-700 dark:text-nord-redText',
  },
  empty: {
    label: 'не заполнено',
    chip: 'chip-muted',
    dot: 'bg-slate-300 dark:bg-nord-3',
    text: 'text-slate-400 dark:text-nord-muted',
  },
};

export const APPLICABILITY_STATUS_STYLES: Record<string, { label: string; chip: string }> = {
  APPLICABLE: {
    label: 'Применимо',
    chip: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-nord-green/15 dark:text-nord-green dark:border-nord-green/40',
  },
  NOT_APPLICABLE: {
    label: 'Не применимо',
    chip: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-nord-1 dark:text-nord-4 dark:border-nord-3',
  },
  UNKNOWN: {
    label: 'Требует подтверждения',
    chip: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-nord-yellow/15 dark:text-nord-yellow dark:border-nord-yellow/40',
  },
};

/**
 * Поверхности студии. Раньше это были тёмные панели модала; студия живёт в
 * общей светлой теме приложения, поэтому карточки плоские — бордер вместо
 * тени, радиус 12, как у остальных экранов новой плотности.
 */
export const PANEL_CLASS = 'card-flat p-4';
export const SUBPANEL_CLASS =
  'rounded-lg border border-slate-200 bg-slate-50/60 dark:border-nord-3 dark:bg-nord-1/50';

/**
 * DOM-идентификатор поля для навигации из панели блокеров. Тот же `fieldRef`,
 * что движок соответствия кладёт в замечание, — по нему шаг находит поле,
 * прокручивает к нему и подсвечивает.
 */
export function fieldAnchorId(fieldRef: string): string {
  return `field-${fieldRef.replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
}
