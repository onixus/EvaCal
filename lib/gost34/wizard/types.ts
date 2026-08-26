/**
 * UI Wizard (PR-10) — модель пошагового выпуска документа.
 *
 * Мастер не хранит собственных данных о проекте: он только собирает решения
 * пользователя (профиль, требования, подтверждение применимости, связи
 * трассировки, реквизиты) и показывает, что мешает выпустить документ.
 * Вся расчётная часть остаётся в движках PR-02…PR-07.
 */

import type { Gost34RequirementItem, Gost34StageItem } from '../types';
import type { Gost34RequirementV2 } from '../requirements/v2';
import type { ProjectContext, ContextGap } from '../context/types';
import type { ApplicabilityResult, ApplicabilityOverride } from '../applicability/types';
import type { ValidationReport } from '../validation/types';
import type { TraceLink, TraceabilityResult } from '../traceability/types';

export type WizardStepId =
  | 'profile'
  | 'requirements'
  | 'applicability'
  | 'traceability'
  | 'signatures'
  | 'preview'
  | 'compliance';

export interface WizardStepDefinition {
  id: WizardStepId;
  /** Порядковый номер шага, 1-based — он же префикс в заголовке вкладки. */
  order: number;
  title: string;
  subtitle: string;
}

/**
 * Состояние шага для индикации в UI.
 * - `empty`: шаг ещё не заполнен, но и не мешает выпуску;
 * - `blocked`: есть замечание, из-за которого документ выпускать нельзя;
 * - `attention`: есть незакрытые вопросы (UNKNOWN, WARNING, UNMAPPED);
 * - `ready`: замечаний нет.
 */
export type WizardStepStatus = 'empty' | 'blocked' | 'attention' | 'ready';

/**
 * Серьёзность замечания. В отличие от статуса шага она задаётся у каждого
 * замечания отдельно: шаг с ошибкой валидации блокирует выпуск, но лежащее
 * рядом WARNING-замечание блокером не является и в панели выпуска показывается
 * как предупреждение.
 */
export type WizardIssueSeverity = 'blocker' | 'warning';

/**
 * Замечание с провенансом: панель блокеров студии показывает не только текст,
 * но и откуда он взялся (шаг, поле) и какое правило его породило, а кнопка
 * «Перейти к полю» ведёт на `stepId` и подсвечивает `fieldRef`.
 */
export interface WizardIssue {
  /** Текст замечания — то же, что показывалось до появления провенанса. */
  text: string;
  severity: WizardIssueSeverity;
  /** Шаг мастера, на котором замечание устраняется. */
  stepId: WizardStepId;
  /**
   * Якорь поля внутри шага, например `signatures.approver` или
   * `requirements.ТР-ПАК-03`. Пустой у замечаний, относящихся к шагу целиком.
   */
  fieldRef?: string;
  /** Человекочитаемое имя поля для строки «Источник: …». */
  fieldLabel?: string;
  /** Машинный идентификатор правила — стабилен между релизами. */
  ruleId?: string;
  /** Человекочитаемое имя правила для строки «Правило: …». */
  ruleLabel?: string;
}

export interface WizardStepReport {
  id: WizardStepId;
  status: WizardStepStatus;
  /** Замечания шага, от блокирующих к информационным, в порядке показа. */
  issues: WizardIssue[];
}

export interface ComplianceReport {
  steps: WizardStepReport[];
  /** Документ можно выпускать: ни одного замечания серьёзности `blocker`. */
  canExport: boolean;
  /** Причины блокировки выпуска, плоским списком для итогового экрана. */
  blockingIssues: string[];
  /** Незакрытые вопросы, не блокирующие выпуск. */
  warnings: string[];
  /**
   * Все замечания комплекта одним списком, блокеры первыми — источник данных
   * для панели блокеров студии. `blockingIssues` и `warnings` остаются
   * текстовыми проекциями этого списка.
   */
  issues: WizardIssue[];
}

/** Расчёт EvaCal в том виде, в каком его принимает анализатор. */
export type WizardCalculationInput = import('../types').Gost34CalculationInput;

/** Сводка применимости, как её считает Applicability Engine. */
export interface ApplicabilitySummary {
  total: number;
  applicable: number;
  unknown: number;
  notApplicable: number;
  confidenceAverage: number;
}

/** Входные данные обзора: то, что мастер собрал у пользователя. */
export interface WizardReviewInput {
  calculation?: WizardCalculationInput;
  /** Требования, извлечённые из вендорских документов или введённые вручную. */
  rawRequirements?: Gost34RequirementItem[];
  vendorFiles?: string[];
  standardProfileId?: string;
  /** Ручные решения по применимости нормативов (шаг «Применимость»). */
  applicabilityOverrides?: Record<string, ApplicabilityOverride>;
  /** Ручные связи «требование → этап» (шаг «Трассируемость»). */
  manualLinks?: TraceLink[];
  projectContext?: Partial<ProjectContext>;
}

/** Результат обзора: всё, что показывают экраны проверки перед выпуском. */
export interface WizardReviewResult {
  profile: {
    id: string;
    name: string;
    version: string;
    status: 'stable' | 'preview';
  };
  requirements: Gost34RequirementV2[];
  stages: Gost34StageItem[];
  validation: ValidationReport;
  applicability: {
    results: ApplicabilityResult[];
    summary: ApplicabilitySummary;
    /** Флаги обогащения, выведенные из применимости, — их и уходит в генератор. */
    options: Record<string, boolean>;
  };
  traceability: TraceabilityResult;
  projectContext: ProjectContext;
  contextGaps: ContextGap[];
  compliance: ComplianceReport;
}
