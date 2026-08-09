import { MODAL_PATTERN_GLOBAL } from '../lexicon';
import { finding, RequirementCheck } from '../context';
import type { ValidationFinding } from '../types';

/** Перечисление внутри требования: пункты списка или разделение через «;». */
const ENUMERATION_PATTERN = /(?:;)|(?:(?:^|\s)[-–—•]\s)|(?:(?:^|\s)\d[).]\s)/u;

/**
 * Единичность (ГОСТ 34.602: одно требование — одно проверяемое утверждение).
 * Составное требование нельзя ни принять, ни отклонить целиком.
 */
export function checkAtomicity(check: RequirementCheck): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  if (!check.text) return findings;

  const modals = check.text.match(MODAL_PATTERN_GLOBAL) || [];
  if (modals.length > 1) {
    findings.push(
      finding(
        check,
        'atomicity',
        'WARNING',
        `Требование содержит ${modals.length} обязывающих утверждений и не является единичным.`,
        'Разделить на отдельные требования, по одному проверяемому утверждению в каждом.',
      ),
    );
  }

  if (ENUMERATION_PATTERN.test(check.text)) {
    findings.push(
      finding(
        check,
        'atomicity',
        'WARNING',
        'Требование содержит перечисление: каждый пункт придётся проверять отдельно.',
        'Вынести пункты перечисления в самостоятельные требования либо оформить как приложение.',
      ),
    );
  }

  return findings;
}
