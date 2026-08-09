import type { ProjectContext } from '../context/types';

/**
 * Статус применимости нормативного акта или стандарта.
 * - APPLICABLE: применимость подтверждена фактами из ProjectContext или ручным решением.
 * - NOT_APPLICABLE: стандарт явно неприменим (например, нет ПДн или КИИ).
 * - UNKNOWN: данных недостаточно, требуется подтверждение у Заказчика.
 */
export type ApplicabilityStatus = 'APPLICABLE' | 'NOT_APPLICABLE' | 'UNKNOWN';

/** Доказательство / факт, найденный в проектном контексте. */
export interface Evidence {
  source: string;
  details: string;
  value?: unknown;
}

/** Итоговый результат оценки применимости одного стандарта. */
export interface ApplicabilityResult {
  /** Идентификатор стандарта (соответствует ключам ENRICHMENT_OPTION_KEYS). */
  standardId: string;
  title: string;
  category: 'security' | 'technical' | 'reliability' | 'ergonomics' | 'regulatory';
  /** Статус, рассчитанный движком правил. */
  calculatedStatus: ApplicabilityStatus;
  /** Итоговый статус с учётом ручного подтверждения / override. */
  finalStatus: ApplicabilityStatus;
  /** Человекочитаемые причины принятого решения. */
  reasons: string[];
  /** Факты из контекста проекта, на которых основано решение. */
  evidence: Evidence[];
  /** Оценка уверенности (0.0 .. 1.0). */
  confidence?: number;
  /** Ручное решение (override / подтверждение). */
  confirmedStatus?: 'APPLICABLE' | 'NOT_APPLICABLE';
  /** Кто подтвердил (ФИО / роль). */
  confirmedBy?: string;
  /** Обоснование ручного решения. */
  overrideReason?: string;
}

/** Структура ручного переопределения статуса применимости. */
export interface ApplicabilityOverride {
  status: 'APPLICABLE' | 'NOT_APPLICABLE';
  confirmedBy?: string;
  reason?: string;
}

/** Интерфейс правила оценки применимости. */
export interface ApplicabilityRule {
  id: string;
  title: string;
  category: 'security' | 'technical' | 'reliability' | 'ergonomics' | 'regulatory';
  evaluate: (context: ProjectContext) => {
    status: ApplicabilityStatus;
    reasons: string[];
    evidence: Evidence[];
    confidence?: number;
  };
}
