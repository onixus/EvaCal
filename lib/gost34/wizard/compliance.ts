import type { ContextGap } from '../context/types';
import type { ValidationReport } from '../validation/types';
import type { TraceabilityResult } from '../traceability/types';
import type {
  ApplicabilitySummary,
  ComplianceReport,
  WizardIssue,
  WizardIssueSeverity,
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

/**
 * Каталог правил, порождающих замечания. Идентификатор машинный и стабильный —
 * на него ссылается панель блокеров и лист внутренних изменений; подпись
 * человекочитаемая и печатается в строке «Правило: …».
 */
export const COMPLIANCE_RULES = {
  profilePreview: {
    id: 'profile/preview-status',
    label: 'реестр нормативных профилей',
  },
  profileLegacy: {
    id: 'profile/legacy-edition',
    label: 'реестр нормативных профилей',
  },
  requirementsEmpty: {
    id: 'requirements/empty',
    label: 'ГОСТ 34.602, состав требований',
  },
  requirementsError: {
    id: 'requirements/validation-error',
    label: 'валидатор формулировок ГОСТ 34.602',
  },
  requirementsWarning: {
    id: 'requirements/validation-warning',
    label: 'валидатор формулировок ГОСТ 34.602',
  },
  applicabilityEmpty: {
    id: 'applicability/not-evaluated',
    label: 'движок применимости',
  },
  applicabilityUnknown: {
    id: 'applicability/unknown-status',
    label: 'движок применимости',
  },
  applicabilityNone: {
    id: 'applicability/none-applicable',
    label: 'движок применимости',
  },
  traceabilityEmpty: {
    id: 'traceability/no-requirements',
    label: 'покрытие матрицы прослеживаемости',
  },
  traceabilityUnmapped: {
    id: 'traceability/unmapped-requirement',
    label: 'покрытие матрицы прослеживаемости',
  },
  traceabilityUnapproved: {
    id: 'traceability/unapproved-link',
    label: 'покрытие матрицы прослеживаемости',
  },
  signaturesMissing: {
    id: 'signatures/required-field-empty',
    label: 'ГОСТ 2.104-2006, обязательные подписи формы 2',
  },
  contextBlocking: {
    id: 'context/blocking-gap',
    label: 'опросник расчёта',
  },
  contextMajor: {
    id: 'context/major-gap',
    label: 'опросник расчёта',
  },
} as const;

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

/** Собирает замечание, подставляя правило из каталога. */
function issue(
  stepId: WizardStepId,
  severity: WizardIssueSeverity,
  rule: { id: string; label: string },
  text: string,
  field?: { ref: string; label: string },
): WizardIssue {
  return {
    text,
    severity,
    stepId,
    fieldRef: field?.ref,
    fieldLabel: field?.label,
    ruleId: rule.id,
    ruleLabel: rule.label,
  };
}

/**
 * Статус шага выводится из его замечаний, а не задаётся отдельно: блокер делает
 * шаг блокирующим, предупреждение — требующим внимания. Пустота шага — особый
 * случай и передаётся явно.
 */
function stepFromIssues(
  id: WizardStepId,
  issues: WizardIssue[],
  emptyStatus?: WizardStepStatus,
): WizardStepReport {
  if (issues.length === 0) return { id, status: emptyStatus ?? 'ready', issues };
  const status: WizardStepStatus = issues.some((i) => i.severity === 'blocker')
    ? 'blocked'
    : (emptyStatus ?? 'attention');
  // Блокеры показываются первыми — и в списке шага, и в панели блокеров студии.
  const ordered = [...issues].sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === 'blocker' ? -1 : 1,
  );
  return { id, status, issues: ordered };
}

function profileStep(input: ComplianceInput): WizardStepReport {
  const issues: WizardIssue[] = [];

  if (input.profile.status === 'preview') {
    issues.push(
      issue(
        'profile',
        'blocker',
        COMPLIANCE_RULES.profilePreview,
        `Профиль «${input.profile.name}» имеет статус preview: структура документа ещё не переведена на эту редакцию.`,
        { ref: 'profile.standardProfileId', label: 'выбор нормативного профиля' },
      ),
    );
  } else if (input.isLegacyProfile) {
    issues.push(
      issue(
        'profile',
        'warning',
        COMPLIANCE_RULES.profileLegacy,
        `Выбран legacy-профиль «${input.profile.name}» (${input.profile.version}). Для новых проектов применяется ГОСТ 34.602-2020.`,
        { ref: 'profile.standardProfileId', label: 'выбор нормативного профиля' },
      ),
    );
  }

  return stepFromIssues('profile', issues);
}

function requirementsStep(input: ComplianceInput): WizardStepReport {
  if (input.requirementCount === 0) {
    return stepFromIssues(
      'requirements',
      [
        issue(
          'requirements',
          'warning',
          COMPLIANCE_RULES.requirementsEmpty,
          'Требования не заданы: загрузите документ вендора или добавьте требования вручную.',
          { ref: 'requirements.list', label: 'список требований' },
        ),
      ],
      'empty',
    );
  }

  const issues: WizardIssue[] = [];
  const errors = input.validation.counts.ERROR || 0;
  const warnings = input.validation.counts.WARNING || 0;

  if (errors > 0) {
    issues.push(
      issue(
        'requirements',
        'blocker',
        COMPLIANCE_RULES.requirementsError,
        `${errors} ${pluralRu(errors, 'требование не удовлетворяет', 'требования не удовлетворяют', 'требований не удовлетворяют')} ГОСТ 34.602 (замечания уровня ERROR).`,
        { ref: 'requirements.list', label: 'строки со статусом ERROR' },
      ),
    );
  }
  if (warnings > 0) {
    issues.push(
      issue(
        'requirements',
        'warning',
        COMPLIANCE_RULES.requirementsWarning,
        `${warnings} ${pluralRu(warnings, 'замечание', 'замечания', 'замечаний')} уровня WARNING: формулировки стоит уточнить.`,
        { ref: 'requirements.list', label: 'строки со статусом WARNING' },
      ),
    );
  }

  return stepFromIssues('requirements', issues);
}

function applicabilityStep(input: ComplianceInput): WizardStepReport {
  const { total, unknown, applicable } = input.applicability;

  if (total === 0) {
    return stepFromIssues(
      'applicability',
      [
        issue(
          'applicability',
          'warning',
          COMPLIANCE_RULES.applicabilityEmpty,
          'Применимость нормативов не оценена.',
        ),
      ],
      'empty',
    );
  }

  const issues: WizardIssue[] = [];
  if (unknown > 0) {
    issues.push(
      issue(
        'applicability',
        'warning',
        COMPLIANCE_RULES.applicabilityUnknown,
        `${unknown} ${pluralRu(unknown, 'норматив требует', 'норматива требуют', 'нормативов требуют')} подтверждения у Заказчика (статус UNKNOWN).`,
        { ref: 'applicability.unknown', label: 'нормативы со статусом UNKNOWN' },
      ),
    );
  }
  if (applicable === 0) {
    issues.push(
      issue(
        'applicability',
        'warning',
        COMPLIANCE_RULES.applicabilityNone,
        'Ни один отраслевой норматив не признан применимым.',
        { ref: 'applicability.list', label: 'список нормативов' },
      ),
    );
  }

  return stepFromIssues('applicability', issues);
}

function traceabilityStep(input: ComplianceInput): WizardStepReport {
  const { metrics, links } = input.traceability;

  if (metrics.totalRequirements === 0) {
    return stepFromIssues(
      'traceability',
      [
        issue(
          'traceability',
          'warning',
          COMPLIANCE_RULES.traceabilityEmpty,
          'Трассировать нечего: нет требований.',
        ),
      ],
      'empty',
    );
  }

  const issues: WizardIssue[] = [];
  if (metrics.unmappedRequirements > 0) {
    issues.push(
      issue(
        'traceability',
        'warning',
        COMPLIANCE_RULES.traceabilityUnmapped,
        `${metrics.unmappedRequirements} ${pluralRu(metrics.unmappedRequirements, 'требование не связано', 'требования не связаны', 'требований не связаны')} с этапами работ (UNMAPPED). Покрытие ${metrics.coveragePercentage}%.`,
        { ref: 'traceability.unmapped', label: 'строки со статусом UNMAPPED' },
      ),
    );
  }

  const unapproved = links.filter((link) => !link.approved).length;
  if (unapproved > 0) {
    issues.push(
      issue(
        'traceability',
        'warning',
        COMPLIANCE_RULES.traceabilityUnapproved,
        `${unapproved} ${pluralRu(unapproved, 'связь предложена', 'связи предложены', 'связей предложено')} автоматически и не подтверждена вручную.`,
        { ref: 'traceability.unapproved', label: 'неподтверждённые связи' },
      ),
    );
  }

  return stepFromIssues('traceability', issues);
}

function signaturesStep(input: ComplianceInput): WizardStepReport {
  // Отсутствующий объект — это та же пустая основная надпись, а не «ещё не дошли».
  const signatures = input.signatures || {};

  const missing = REQUIRED_SIGNATURE_FIELDS.filter(
    (field) => !String(signatures[field.key] ?? '').trim(),
  );

  if (missing.length === 0) return stepFromIssues('signatures', []);

  // Каждое пустое поле — отдельное замечание: панель блокеров ведёт точно к нему,
  // а не к шагу целиком.
  const issues = missing.map((field) =>
    issue(
      'signatures',
      'blocker',
      COMPLIANCE_RULES.signaturesMissing,
      `Не заполнено поле основной надписи «${field.label}».`,
      { ref: `signatures.${field.key}`, label: `поле «${field.label}»` },
    ),
  );

  return stepFromIssues('signatures', issues);
}

/**
 * Пробелы проектного контекста не блокируют выпуск: их источник — опросник и
 * расчёт, а не мастер, и документ печатает по ним явную отметку «требует
 * уточнения» вместо выдуманного значения. Скрывать их тоже нельзя, поэтому
 * шаг остаётся в статусе «требует внимания» с указанием, где заполнять.
 */
function complianceStep(input: ComplianceInput): WizardStepReport {
  const gaps = input.contextGaps || [];
  const blocking = gaps.filter((gap) => gap.severity === 'blocking');
  const major = gaps.filter((gap) => gap.severity === 'major');

  const issues: WizardIssue[] = [];
  if (blocking.length > 0) {
    issues.push(
      issue(
        'compliance',
        'warning',
        COMPLIANCE_RULES.contextBlocking,
        `Обязательные сведения о проекте не заполнены и попадут в документ с отметкой «требует уточнения»: ${blocking
          .map((gap) => gap.label)
          .join(', ')}. Источник — опросник расчёта.`,
        { ref: 'context.blocking', label: 'опросник расчёта' },
      ),
    );
  }
  if (major.length > 0) {
    issues.push(
      issue(
        'compliance',
        'warning',
        COMPLIANCE_RULES.contextMajor,
        `Требуют уточнения: ${major.map((gap) => gap.label).join(', ')}.`,
        { ref: 'context.major', label: 'опросник расчёта' },
      ),
    );
  }

  return stepFromIssues('compliance', issues);
}

function previewStep(): WizardStepReport {
  return { id: 'preview', status: 'ready', issues: [] };
}

const STEP_BUILDERS: Record<WizardStepId, (input: ComplianceInput) => WizardStepReport> = {
  profile: profileStep,
  requirements: requirementsStep,
  applicability: applicabilityStep,
  traceability: traceabilityStep,
  signatures: signaturesStep,
  preview: previewStep,
  compliance: complianceStep,
};

/**
 * Считает состояние каждого шага мастера и итоговую готовность к выпуску.
 * Блокируют выпуск только те замечания, которые делают документ несоответствующим
 * и которые можно устранить в самом мастере: preview-профиль, ошибки валидации
 * требований и пустая основная надпись. Статус UNKNOWN у нормативов, непокрытые
 * требования и пробелы проектного контекста выпуск не блокируют, но остаются
 * видимыми.
 */
export function buildComplianceReport(input: ComplianceInput): ComplianceReport {
  const steps = WIZARD_STEP_IDS.map((id) => STEP_BUILDERS[id](input));

  // Серьёзность берётся у самого замечания, а не у шага: WARNING-замечание,
  // лежащее на заблокированном шаге, блокером не становится.
  const issues = steps.flatMap((step) => step.issues);
  const blockers = issues.filter((i) => i.severity === 'blocker');

  return {
    steps,
    canExport: blockers.length === 0,
    blockingIssues: blockers.map((i) => i.text),
    warnings: issues.filter((i) => i.severity === 'warning').map((i) => i.text),
    issues: [...blockers, ...issues.filter((i) => i.severity === 'warning')],
  };
}
