/**
 * #103 WP-2a: запросы на изменение требований.
 *
 * Запрос фиксирует, что и почему меняется относительно согласованной базы
 * (версия расчёта + необязательный комплект ГОСТ 34). До решения «принять»
 * база не меняется; решение и новая версия — WP-2b.
 */

export const CHANGE_REQUEST_STATUSES = [
  'draft',
  'submitted',
  'accepted',
  'rejected',
  'deferred',
] as const;
export type ChangeRequestStatus = (typeof CHANGE_REQUEST_STATUSES)[number];

export const CHANGE_REQUEST_STATUS_LABELS: Record<ChangeRequestStatus, string> = {
  draft: 'Черновик',
  submitted: 'На оценке',
  accepted: 'Принят',
  rejected: 'Отклонён',
  deferred: 'Отложен',
};

export const CHANGE_REQUEST_ACTIONS = [
  'created',
  'updated',
  'submitted',
  'estimated',
  'accepted',
  'rejected',
  'deferred',
  'reopened',
] as const;
export type ChangeRequestAction = (typeof CHANGE_REQUEST_ACTIONS)[number];

export const CHANGE_REQUEST_ACTION_LABELS: Record<ChangeRequestAction, string> = {
  created: 'Создан',
  updated: 'Изменён черновик',
  submitted: 'Передан на оценку',
  estimated: 'Оценка специалиста',
  accepted: 'Принят',
  rejected: 'Отклонён',
  deferred: 'Отложен',
  reopened: 'Возвращён на оценку',
};

/** Снимок требования базового комплекта на момент выбора. */
export interface AffectedRequirement {
  id: string;
  code: string;
  text: string;
}

export type ProposedChangeKind = 'add' | 'modify' | 'remove';

export interface ProposedChangeItem {
  kind: ProposedChangeKind;
  /** Требование базового комплекта; null — новое требование. */
  requirementId: string | null;
  text: string;
}

export interface ProposedChanges {
  summary: string;
  items: ProposedChangeItem[];
}

/** Этап базового расчёта, связанный с затронутыми требованиями. */
export interface ImpactStage {
  id: string;
  name: string;
  role: string;
  /**
   * Часы этапа в базовом расчёте — только как контекст для специалиста.
   * Связь требования с этапом не означает, что меняются все часы этапа,
   * поэтому сумма по этапам нигде не считается.
   */
  baseHours: number | null;
  requirementIds: string[];
  /**
   * Из них связаны правилом движка трассировки (RULE), а не ручным решением —
   * связь предположительная, специалисту стоит её проверить.
   */
  ruleRequirementIds: string[];
}

export interface ImpactDocument {
  type: string;
  label: string;
}

export interface ImpactCheck {
  requirementId: string;
  code: string;
  /** Критерий приёмки из требования (формальные проверки — раздел 2 #103). */
  criterion: string;
  source: 'requirement-criterion';
}

export interface ChangeImpact {
  base: {
    calculationId: string;
    calculationVersion: number;
    currency: string;
    packageId: string | null;
    packageVersion: number | null;
  };
  stages: ImpactStage[];
  documents: ImpactDocument[];
  checks: ImpactCheck[];
  /** Требования без связи с этапом в снимке комплекта. */
  unlinkedRequirementIds: string[];
  computedAt: string;
}

export interface ChangeEstimate {
  hours: number;
  /** Десятичная строка, 2 знака. */
  cost: string;
  scheduleDays: number;
  comment: string | null;
}
