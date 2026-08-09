import type { Gost34RequirementV2 } from '../requirements';
import { buildCheck, RequirementCheck } from './context';
import { checkAtomicity } from './rules/atomicity';
import { checkAmbiguity } from './rules/ambiguity';
import { checkMeasurability } from './rules/measurability';
import { checkCompleteness } from './rules/completeness';
import { checkTestability } from './rules/testability';
import { checkSource } from './rules/source';
import { checkConflicts } from './rules/conflict';
import type {
  ValidationFinding,
  ValidationOptions,
  ValidationReport,
  ValidationRuleId,
  ValidationSeverity,
} from './types';

export * from './types';
export type { RequirementCheck } from './context';

/** Проверки, работающие по одному требованию. */
const PER_REQUIREMENT_RULES: Array<{
  id: ValidationRuleId;
  run: (check: RequirementCheck) => ValidationFinding[];
}> = [
  { id: 'completeness', run: checkCompleteness },
  { id: 'atomicity', run: checkAtomicity },
  { id: 'ambiguity', run: checkAmbiguity },
  { id: 'measurability', run: checkMeasurability },
  { id: 'testability', run: checkTestability },
  { id: 'source', run: checkSource },
];

const SEVERITY_ORDER: Record<ValidationSeverity, number> = {
  ERROR: 0,
  WARNING: 1,
  INFO: 2,
};

function isRuleEnabled(options: ValidationOptions, rule: ValidationRuleId): boolean {
  return options.rules?.[rule] !== false;
}

/**
 * Текст требований из встроенной нормативной библиотеки не редактируется
 * пользователем, поэтому его замечания не должны блокировать выпуск документа.
 */
function capLibrarySeverity(finding: ValidationFinding, isLibrary: boolean): ValidationFinding {
  if (!isLibrary || finding.severity !== 'ERROR') return finding;

  return { ...finding, severity: 'WARNING' };
}

export function validateRequirements(
  requirements: Gost34RequirementV2[] = [],
  options: ValidationOptions = {},
): ValidationReport {
  const checks = requirements.map(buildCheck);
  const findings: ValidationFinding[] = [];

  checks.forEach((check) => {
    PER_REQUIREMENT_RULES.forEach((rule) => {
      if (!isRuleEnabled(options, rule.id)) return;

      rule.run(check).forEach((item) => findings.push(capLibrarySeverity(item, check.isLibrary)));
    });
  });

  if (isRuleEnabled(options, 'conflict')) {
    const libraryIds = new Set(checks.filter((c) => c.isLibrary).map((c) => c.requirement.id));
    checkConflicts(checks).forEach((item) =>
      findings.push(capLibrarySeverity(item, libraryIds.has(item.requirementId || ''))),
    );
  }

  const orderById = new Map(requirements.map((req, index) => [req.id, index]));
  findings.sort((a, b) => {
    const orderA = orderById.get(a.requirementId || '') ?? Number.MAX_SAFE_INTEGER;
    const orderB = orderById.get(b.requirementId || '') ?? Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;

    return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  });

  const counts: Record<ValidationSeverity, number> = {
    ERROR: 0,
    WARNING: 0,
    INFO: 0,
  };
  const byRequirement: Record<string, ValidationFinding[]> = {};

  findings.forEach((item) => {
    counts[item.severity] += 1;

    const key = item.requirementId || '';
    (byRequirement[key] ||= []).push(item);
  });

  return {
    findings,
    counts,
    byRequirement,
    hasBlockingFindings: counts.ERROR > 0,
  };
}

/** Проверка одного требования вне набора: сводные правила при этом не работают. */
export function validateRequirement(
  requirement: Gost34RequirementV2,
  options: ValidationOptions = {},
): ValidationReport {
  return validateRequirements([requirement], options);
}

/** Однострочное представление замечания для логов и текстовых отчётов. */
export function formatValidationFinding(finding: ValidationFinding): string {
  const code = finding.requirementCode ? `${finding.requirementCode}: ` : '';
  const suggestion = finding.suggestion ? ` Рекомендация: ${finding.suggestion}` : '';

  return `${finding.severity} [${finding.rule}] ${code}${finding.message}${suggestion}`;
}
