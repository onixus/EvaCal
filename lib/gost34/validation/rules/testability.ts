import { finding, RequirementCheck } from '../context';
import type { ValidationFinding } from '../types';

/**
 * Проверяемость. Требование проверяемо, если задан метод верификации или
 * критерии приёмки, либо формулировка сама содержит измеримый показатель.
 *
 * Оценочная формулировка без числового показателя делает требование
 * непроверяемым — это ошибка, а не замечание (ГОСТ 34.602, приёмочные испытания).
 */
export function checkTestability(check: RequirementCheck): ValidationFinding[] {
  if (!check.text) return [];

  const hasVerification = Boolean(check.requirement.verificationMethod);
  const hasCriteria = Boolean(check.requirement.acceptanceCriteria?.length);
  if (hasVerification || hasCriteria) return [];

  if (check.vagueTerms.length && !check.measurable) {
    return [
      finding(
        check,
        'testability',
        'ERROR',
        'Требование непроверяемо: формулировка оценочная, измеримый показатель не задан.',
        'Задать измеримый показатель либо критерии приёмки и метод верификации (INSPECTION / ANALYSIS / DEMONSTRATION / TEST).',
      ),
    ];
  }

  if (check.measurable) {
    return [
      finding(
        check,
        'testability',
        'INFO',
        'Не указан метод верификации, хотя показатель задан численно.',
        'Указать метод верификации, чтобы требование попало в программу и методику испытаний.',
      ),
    ];
  }

  return [
    finding(
      check,
      'testability',
      'WARNING',
      'Не заданы ни метод верификации, ни критерии приёмки.',
      'Указать метод верификации и критерии приёмки для включения требования в ПМИ.',
    ),
  ];
}
