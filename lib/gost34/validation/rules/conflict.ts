import {
  CONFLICT_INDICATORS,
  LOWER_BOUND_PATTERN,
  UPPER_BOUND_PATTERN,
  MODAL_PATTERN_GLOBAL,
  NEGATION_PATTERN,
  parseNumber,
} from '../lexicon';
import { finding, RequirementCheck } from '../context';
import type { ValidationFinding } from '../types';

interface Bound {
  value: number;
  unit: string;
}

function parseBound(text: string, pattern: RegExp): Bound | undefined {
  const match = text.match(pattern);
  if (!match) return undefined;

  const value = parseNumber(match[1]);
  if (!Number.isFinite(value)) return undefined;

  return { value, unit: (match[2] || '').toLowerCase() };
}

/** Границы сравнимы только при совпадающей единице измерения. */
function comparable(a: Bound, b: Bound): boolean {
  return a.unit === b.unit;
}

/** Смысловой ключ требования без обязывающих слов и отрицания — для поиска зеркальных пар. */
function semanticKey(text: string): string {
  return text
    .toLowerCase()
    .replace(MODAL_PATTERN_GLOBAL, ' ')
    .replace(/(?:^|[^0-9a-zа-яё])не(?=[^0-9a-zа-яё])/giu, ' ')
    .replace(/[^0-9a-zа-яё]+/giu, ' ')
    .trim();
}

function declaredConflicts(checks: RequirementCheck[]): ValidationFinding[] {
  const byId = new Map(checks.map((check) => [check.requirement.id, check]));
  const findings: ValidationFinding[] = [];

  for (const check of checks) {
    for (const relation of check.requirement.relations || []) {
      if (relation.type !== 'CONFLICTS_WITH') continue;

      const other = byId.get(relation.targetRequirementId);
      const otherCode = other?.requirement.code || relation.targetRequirementId;

      findings.push(
        finding(
          check,
          'conflict',
          'ERROR',
          `Объявлено противоречие с требованием ${otherCode}.`,
          'Снять противоречие: уточнить область действия одного из требований либо отменить одно из них.',
          [relation.targetRequirementId]
        )
      );
    }
  }

  return findings;
}

function indicatorConflicts(checks: RequirementCheck[]): ValidationFinding[] {
  const findings: ValidationFinding[] = [];

  for (const indicator of CONFLICT_INDICATORS) {
    const matched = checks
      .filter((check) => indicator.pattern.test(check.text))
      .map((check) => ({
        check,
        upper: parseBound(check.text, UPPER_BOUND_PATTERN),
        lower: parseBound(check.text, LOWER_BOUND_PATTERN),
      }))
      .filter((entry) => entry.upper || entry.lower);

    for (let i = 0; i < matched.length; i += 1) {
      for (let j = i + 1; j < matched.length; j += 1) {
        const a = matched[i];
        const b = matched[j];

        let reason: string | undefined;

        if (a.upper && b.upper && comparable(a.upper, b.upper) && a.upper.value !== b.upper.value) {
          reason = `заданы разные верхние границы (${a.upper.value} и ${b.upper.value})`;
        } else if (a.upper && b.lower && comparable(a.upper, b.lower) && b.lower.value > a.upper.value) {
          reason = `нижняя граница ${b.lower.value} превышает верхнюю границу ${a.upper.value}`;
        } else if (b.upper && a.lower && comparable(b.upper, a.lower) && a.lower.value > b.upper.value) {
          reason = `нижняя граница ${a.lower.value} превышает верхнюю границу ${b.upper.value}`;
        }

        if (!reason) continue;

        findings.push(
          finding(
            a.check,
            'conflict',
            'ERROR',
            `Противоречие с требованием ${b.check.requirement.code} по показателю «${indicator.label}»: ${reason}.`,
            'Согласовать единое значение показателя либо явно разграничить условия применения требований.',
            [b.check.requirement.id]
          )
        );
      }
    }
  }

  return findings;
}

function negationConflicts(checks: RequirementCheck[]): ValidationFinding[] {
  const byKey = new Map<string, RequirementCheck[]>();

  for (const check of checks) {
    if (!check.text) continue;
    const key = semanticKey(check.text);
    if (!key) continue;

    const bucket = byKey.get(key);
    if (bucket) bucket.push(check);
    else byKey.set(key, [check]);
  }

  const findings: ValidationFinding[] = [];

  for (const bucket of byKey.values()) {
    if (bucket.length < 2) continue;

    const negated = bucket.filter((check) => NEGATION_PATTERN.test(check.text));
    const affirmed = bucket.filter((check) => !NEGATION_PATTERN.test(check.text));
    if (!negated.length || !affirmed.length) continue;

    for (const check of affirmed) {
      findings.push(
        finding(
          check,
          'conflict',
          'ERROR',
          `Требование прямо противоречит ${negated.map((n) => n.requirement.code).join(', ')}: одно и то же утверждение задано с отрицанием и без него.`,
          'Оставить одну формулировку либо разграничить условия применения.',
          negated.map((n) => n.requirement.id)
        )
      );
    }
  }

  return findings;
}

/**
 * Непротиворечивость. Сводная проверка: работает по набору требований целиком,
 * а не по одному требованию.
 */
export function checkConflicts(checks: RequirementCheck[]): ValidationFinding[] {
  return [...declaredConflicts(checks), ...indicatorConflicts(checks), ...negationConflicts(checks)];
}
