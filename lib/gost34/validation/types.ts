/**
 * GOST 34 Requirement Validator — модель результата.
 *
 * Требование по ГОСТ 34.602 должно быть единичным, непротиворечивым,
 * однозначным, выполнимым и проверяемым. Валидатор не правит текст —
 * он только сообщает, чем требование не удовлетворяет этим свойствам.
 */

export type ValidationSeverity = 'ERROR' | 'WARNING' | 'INFO';

export type ValidationRuleId =
  | 'atomicity'
  | 'ambiguity'
  | 'measurability'
  | 'conflict'
  | 'completeness'
  | 'testability'
  | 'source';

export interface ValidationFinding {
  severity: ValidationSeverity;

  /** Требование, к которому относится замечание. Отсутствует у сводных проверок. */
  requirementId?: string;
  requirementCode?: string;

  rule: ValidationRuleId;

  message: string;
  suggestion?: string;

  /** Другие требования, участвующие в замечании (конфликт, дублирование). */
  relatedRequirementIds?: string[];
}

export interface ValidationReport {
  findings: ValidationFinding[];
  counts: Record<ValidationSeverity, number>;
  /** Замечания, сгруппированные по `requirementId`. Сводные — под ключом `''`. */
  byRequirement: Record<string, ValidationFinding[]>;
  /** Есть хотя бы один ERROR: документ нельзя считать готовым к согласованию. */
  hasBlockingFindings: boolean;
}

export interface ValidationOptions {
  /** Отключение отдельных правил: `{ ambiguity: false }`. По умолчанию включены все. */
  rules?: Partial<Record<ValidationRuleId, boolean>>;
}
