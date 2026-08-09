import type { Gost34RequirementV2 } from '../requirements';
import { getRequirementEffectiveText } from '../requirements';
import { hasMeasurableValue, findVagueTerms, MODAL_PATTERN } from './lexicon';
import type { ValidationFinding, ValidationRuleId, ValidationSeverity } from './types';

/** Предрасчёт по одному требованию: правила не должны разбирать текст повторно. */
export interface RequirementCheck {
  requirement: Gost34RequirementV2;
  /** Текст, который попадёт в документ (нормализованный после утверждения, иначе исходный). */
  text: string;
  hasModal: boolean;
  measurable: boolean;
  vagueTerms: string[];
  /**
   * Требование из встроенной библиотеки нормативного обогащения: текст канонический,
   * источник — сам нормативный акт. Замечания к нему не должны блокировать выпуск.
   */
  isLibrary: boolean;
}

export function buildCheck(requirement: Gost34RequirementV2): RequirementCheck {
  const text = getRequirementEffectiveText(requirement);

  return {
    requirement,
    text,
    hasModal: MODAL_PATTERN.test(text),
    measurable: hasMeasurableValue(text),
    vagueTerms: findVagueTerms(text),
    isLibrary: requirement.type === 'regulatory' && !requirement.source,
  };
}

export function finding(
  check: RequirementCheck,
  rule: ValidationRuleId,
  severity: ValidationSeverity,
  message: string,
  suggestion?: string,
  relatedRequirementIds?: string[],
): ValidationFinding {
  const result: ValidationFinding = {
    severity,
    rule,
    requirementId: check.requirement.id,
    requirementCode: check.requirement.code,
    message,
  };

  if (suggestion) result.suggestion = suggestion;
  if (relatedRequirementIds?.length) result.relatedRequirementIds = relatedRequirementIds;

  return result;
}
