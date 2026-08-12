import type { ContextGap } from '../context/types';
import type { ValidationReport } from '../validation/types';
import type { TraceabilityResult } from '../traceability/types';
import type {
  ApplicabilitySummary,
  ComplianceReport,
  WizardStepId,
  WizardStepReport,
  WizardStepStatus,
} from './types';
import { WIZARD_STEP_IDS } from './steps';

/** Реквизиты основной надписи, без которых документ нельзя сдать на нормоконтроль. */
export const REQUIRED_SIGNATURE_FIELDS = [
  { key: 'developer', label: 'Разработал' },
  { key: 'checker', label: 'Проверил' },
  { key: 'normControl', label: 'Нормоконтроль' },
  { key: 'approver', label: 'Утвердил от Исполнителя' },
  { key: 'customerApprover', label: 'Утвердил от Заказчика' },
] as const;

export interface ComplianceInput {
  profile: { id: string; name: string; version: string; status: 'stable' | 'preview' };
  /** Профиль, помеченный в реестре как legacy: выпуск разрешён, но с предупреждением. */
  isLegacyProfile?: boolean;
  requirementCount: number;
  validation: ValidationReport;
  applicability: ApplicabilitySummary;
  traceability: TraceabilityResult;
  signatures?: Record<string, string | undefined>;
  contextGaps?: ContextGap[];
}

function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function profileStep(input: ComplianceInput): WizardStepReport {
  const issues: string[] = [];
  let status: WizardStepStatus = 'ready';

  if (input.profile.status === 'preview') {
    issues.push(
      `Профиль «${input.profile.name}» имеет статус preview: структура документа ещё не переведена на эту редакцию.`,
    );
    status = 'blocked';
  } else if (input.isLegacyProfile) {
    issues.push(
      `Выбран legacy-профиль «${input.profile.name}» (${input.profile.version}). Для новых проектов применяется ГОСТ 34.602-2020.`,
    );
    status = 'attention';
  }

  return { id: 'profile', status, issues };
}

function requirementsStep(input: ComplianceInput): WizardStepReport {
  const issues: string[] = [];

  if (input.requirementCount === 0) {
    return {
      id: 'requirements',
      status: 'empty',
      issues: ['Требования не заданы: загрузите документ вендора или добавьте требования вручную.'],
    };
  }

  const errors = input.validation.counts.ERROR || 0;
  const warnings = input.validation.counts.WARNING || 0;

  if (errors > 0) {
    issues.push(
      `${errors} ${pluralRu(errors, 'требование не удовлетворяет', 'требования не удовлетворяют', 'требований не удовлетворяют')} ГОСТ 34.602 (замечания уровня ERROR).`,
    );
  }
  if (warnings > 0) {
    issues.push(
      `${warnings} ${pluralRu(warnings, 'замечание', 'замечания', 'замечаний')} уровня WARNING: формулировки стоит уточнить.`,
    );
  }

  const status: WizardStepStatus = errors > 0 ? 'blocked' : warnings > 0 ? 'attention' : 'ready';
  return { id: 'requirements', status, issues };
}

function applicabilityStep(input: ComplianceInput): WizardStepReport {
  const { total, unknown, applicable } = input.applicability;

  if (total === 0) {
    return {
      id: 'applicability',
      status: 'empty',
      issues: ['Применимость нормативов не оценена.'],
    };
  }

  const issues: string[] = [];
  if (unknown > 0) {
    issues.push(
      `${unknown} ${pluralRu(unknown, 'норматив требует', 'норматива требуют', 'нормативов требуют')} подтверждения у Заказчика (статус UNKNOWN).`,
    );
  }
  if (applicable === 0) {
    issues.push('Ни один отраслевой норматив не признан применимым.');
  }

  return {
    id: 'applicability',
    status: unknown > 0 ? 'attention' : 'ready',
    issues,
  };
}

function traceabilityStep(input: ComplianceInput): WizardStepReport {
  const { metrics, links } = input.traceability;

  if (metrics.totalRequirements === 0) {
    return {
      id: 'traceability',
      status: 'empty',
      issues: ['Трассировать нечего: нет требований.'],
    };
  }

  const issues: string[] = [];
  if (metrics.unmappedRequirements > 0) {
    issues.push(
      `${metrics.unmappedRequirements} ${pluralRu(metrics.unmappedRequirements, 'требование не связано', 'требования не связаны', 'требований не связаны')} с этапами работ (UNMAPPED). Покрытие ${metrics.coveragePercentage}%.`,
    );
  }

  const unapproved = links.filter((link) => !link.approved).length;
  if (unapproved > 0) {
    issues.push(
      `${unapproved} ${pluralRu(unapproved, 'связь предложена', 'связи предложены', 'связей предложено')} автоматически и не подтверждена вручную.`,
    );
  }

  return {
    id: 'traceability',
    status: issues.length > 0 ? 'attention' : 'ready',
    issues,
  };
}

function signaturesStep(input: ComplianceInput): WizardStepReport {
  const signatures = input.signatures;
  if (!signatures) {
    return { id: 'signatures', status: 'empty', issues: ['Реквизиты основной надписи не заданы.'] };
  }

  const missing = REQUIRED_SIGNATURE_FIELDS.filter(
    (field) => !String(signatures[field.key] ?? '').trim(),
  ).map((field) => field.label);

  if (missing.length === 0) return { id: 'signatures', status: 'ready', issues: [] };

  return {
    id: 'signatures',
    status: 'blocked',
    issues: [`Не заполнены поля основной надписи: ${missing.join(', ')}.`],
  };
}

function complianceStep(input: ComplianceInput): WizardStepReport {
  const gaps = input.contextGaps || [];
  const blocking = gaps.filter((gap) => gap.severity === 'blocking');
  const major = gaps.filter((gap) => gap.severity === 'major');

  const issues: string[] = [];
  if (blocking.length > 0) {
    issues.push(
      `Не заполнены обязательные сведения о проекте: ${blocking.map((gap) => gap.label).join(', ')}.`,
    );
  }
  if (major.length > 0) {
    issues.push(`Требуют уточнения: ${major.map((gap) => gap.label).join(', ')}.`);
  }

  const status: WizardStepStatus =
    blocking.length > 0 ? 'blocked' : major.length > 0 ? 'attention' : 'ready';

  return { id: 'compliance', status, issues };
}

const STEP_BUILDERS: Record<WizardStepId, (input: ComplianceInput) => WizardStepReport> = {
  profile: profileStep,
  requirements: requirementsStep,
  applicability: applicabilityStep,
  traceability: traceabilityStep,
  signatures: signaturesStep,
  compliance: complianceStep,
};

/**
 * Считает состояние каждого шага мастера и итоговую готовность к выпуску.
 * Блокируют выпуск только те замечания, которые делают документ несоответствующим:
 * preview-профиль, ошибки валидации требований, пустая основная надпись и
 * блокирующие пробелы проектного контекста. Статус UNKNOWN у нормативов и
 * непокрытые требования выпуск не блокируют, но остаются видимыми.
 */
export function buildComplianceReport(input: ComplianceInput): ComplianceReport {
  const steps = WIZARD_STEP_IDS.map((id) => STEP_BUILDERS[id](input));

  const blockingIssues = steps.filter((s) => s.status === 'blocked').flatMap((s) => s.issues);
  const warnings = steps.filter((s) => s.status === 'attention').flatMap((s) => s.issues);

  return {
    steps,
    canExport: blockingIssues.length === 0,
    blockingIssues,
    warnings,
  };
}
