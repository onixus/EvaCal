import { describe, it, expect } from 'vitest';
import { buildComplianceReport, REQUIRED_SIGNATURE_FIELDS } from '../compliance';
import { WIZARD_STEPS, WIZARD_STEP_IDS, adjacentWizardStep, getWizardStep } from '../steps';
import { buildWizardReview } from '../review';
import { CURRENT_GOST34_PROFILE_ID, LEGACY_GOST34_PROFILE_ID } from '../../standards';
import type { ComplianceInput } from '../compliance';
import type { ValidationReport } from '../../validation/types';
import type { TraceabilityResult } from '../../traceability/types';

const CLEAN_VALIDATION: ValidationReport = {
  findings: [],
  counts: { ERROR: 0, WARNING: 0, INFO: 0 },
  byRequirement: {},
  hasBlockingFindings: false,
};

const FULL_TRACEABILITY: TraceabilityResult = {
  links: [{ sourceId: 'req-1', targetId: 'stage-1', method: 'MANUAL', approved: true }],
  metrics: {
    totalRequirements: 1,
    mappedRequirements: 1,
    unmappedRequirements: 0,
    coveragePercentage: 100,
  },
};

const FULL_SIGNATURES = Object.fromEntries(
  REQUIRED_SIGNATURE_FIELDS.map((field) => [field.key, 'Иванов А.В.']),
);

function complianceInput(overrides: Partial<ComplianceInput> = {}): ComplianceInput {
  return {
    profile: {
      id: CURRENT_GOST34_PROFILE_ID,
      name: 'ГОСТ 34.602-2020',
      version: '2020',
      status: 'stable',
    },
    requirementCount: 1,
    validation: CLEAN_VALIDATION,
    applicability: {
      total: 13,
      applicable: 4,
      unknown: 0,
      notApplicable: 9,
      confidenceAverage: 0.8,
    },
    traceability: FULL_TRACEABILITY,
    signatures: FULL_SIGNATURES,
    contextGaps: [],
    ...overrides,
  };
}

describe('шаги мастера', () => {
  it('перечисляет шаги в порядке выпуска документа', () => {
    expect(WIZARD_STEP_IDS).toEqual([
      'profile',
      'requirements',
      'applicability',
      'traceability',
      'signatures',
      'compliance',
    ]);
    expect(WIZARD_STEPS.map((step) => step.order)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('ходит по соседним шагам и останавливается на краях', () => {
    expect(adjacentWizardStep('profile', 'next')).toBe('requirements');
    expect(adjacentWizardStep('requirements', 'prev')).toBe('profile');
    expect(adjacentWizardStep('profile', 'prev')).toBeUndefined();
    expect(adjacentWizardStep('compliance', 'next')).toBeUndefined();
    expect(getWizardStep('compliance').title).toBe('Соответствие и выпуск');
  });
});

describe('сводка соответствия', () => {
  it('разрешает выпуск, когда замечаний нет', () => {
    const report = buildComplianceReport(complianceInput());
    expect(report.canExport).toBe(true);
    expect(report.blockingIssues).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.steps.every((step) => step.status === 'ready')).toBe(true);
  });

  it('блокирует выпуск при ошибках валидации требований', () => {
    const report = buildComplianceReport(
      complianceInput({
        validation: {
          ...CLEAN_VALIDATION,
          counts: { ERROR: 2, WARNING: 1, INFO: 0 },
          hasBlockingFindings: true,
        },
      }),
    );

    expect(report.canExport).toBe(false);
    expect(report.steps.find((s) => s.id === 'requirements')?.status).toBe('blocked');
    expect(report.blockingIssues.join(' ')).toContain('2 требования не удовлетворяют');
  });

  it('блокирует выпуск при незаполненной основной надписи', () => {
    const report = buildComplianceReport(
      complianceInput({ signatures: { ...FULL_SIGNATURES, normControl: '  ' } }),
    );

    expect(report.canExport).toBe(false);
    expect(report.blockingIssues.join(' ')).toContain('Нормоконтроль');
  });

  it('блокирует выпуск при preview-профиле', () => {
    const report = buildComplianceReport(
      complianceInput({
        profile: { id: 'x', name: 'Черновой профиль', version: '2030', status: 'preview' },
      }),
    );

    expect(report.canExport).toBe(false);
    expect(report.steps.find((s) => s.id === 'profile')?.status).toBe('blocked');
    expect(report.blockingIssues).toHaveLength(1);
  });

  it('блокирует выпуск, если основная надпись не передана вовсе', () => {
    const report = buildComplianceReport(complianceInput({ signatures: undefined }));

    expect(report.canExport).toBe(false);
    expect(report.steps.find((s) => s.id === 'signatures')?.status).toBe('blocked');
  });

  it('не блокирует выпуск из-за пробелов контекста, но показывает их', () => {
    const report = buildComplianceReport(
      complianceInput({
        contextGaps: [
          { path: 'goals', label: 'Цели создания системы', severity: 'blocking' },
          { path: 'dataClasses', label: 'Классы данных', severity: 'major' },
        ],
      }),
    );

    expect(report.canExport).toBe(true);
    expect(report.steps.find((s) => s.id === 'compliance')?.status).toBe('attention');
    expect(report.warnings.join(' ')).toContain('Цели создания системы');
    expect(report.warnings.join(' ')).toContain('Классы данных');
  });

  it('не блокирует выпуск из-за UNKNOWN-нормативов и непокрытых требований', () => {
    const report = buildComplianceReport(
      complianceInput({
        applicability: {
          total: 13,
          applicable: 2,
          unknown: 5,
          notApplicable: 6,
          confidenceAverage: 0.4,
        },
        traceability: {
          links: [{ sourceId: 'req-1', targetId: 'stage-1', method: 'RULE', approved: false }],
          metrics: {
            totalRequirements: 4,
            mappedRequirements: 1,
            unmappedRequirements: 3,
            coveragePercentage: 25,
          },
        },
      }),
    );

    expect(report.canExport).toBe(true);
    expect(report.steps.find((s) => s.id === 'applicability')?.status).toBe('attention');
    expect(report.steps.find((s) => s.id === 'traceability')?.status).toBe('attention');
    expect(report.warnings.join(' ')).toContain('5 нормативов требуют подтверждения');
    expect(report.warnings.join(' ')).toContain('3 требования не связаны');
  });

  it('предупреждает о legacy-профиле, но выпуск разрешает', () => {
    const report = buildComplianceReport(
      complianceInput({
        profile: {
          id: LEGACY_GOST34_PROFILE_ID,
          name: 'ГОСТ 34.602-89',
          version: '1989',
          status: 'stable',
        },
        isLegacyProfile: true,
      }),
    );

    expect(report.canExport).toBe(true);
    expect(report.steps.find((s) => s.id === 'profile')?.status).toBe('attention');
    expect(report.warnings.join(' ')).toContain('legacy-профиль');
  });

  it('помечает шаг требований как пустой, когда требований нет', () => {
    const report = buildComplianceReport(complianceInput({ requirementCount: 0 }));
    const step = report.steps.find((s) => s.id === 'requirements');

    expect(step?.status).toBe('empty');
    expect(report.canExport).toBe(true);
  });
});

describe('обзор мастера', () => {
  const calculation = {
    id: 'calc-1',
    name: 'Система учёта заявок',
    customer: 'ПАО «Заказчик»',
    answers: { personalData: true, industry: 'finance' },
    pmHours: 40,
    stages: [
      {
        id: 'stage-1',
        order: 1,
        name: 'Обследование',
        role: 'аналитик',
        hours: 80,
        requirements: 'Система должна вести журнал обращений пользователей.',
      },
      { id: 'stage-2', order: 2, name: 'Разработка', role: 'разработчик', hours: 200 },
    ],
    risks: [{ id: 'risk-1', description: 'Задержка поставки оборудования', hours: 20 }],
  };

  it('собирает требования, этапы, применимость и трассировку из расчёта', () => {
    const review = buildWizardReview({ calculation });

    expect(review.profile.id).toBe(CURRENT_GOST34_PROFILE_ID);
    expect(review.stages).toHaveLength(2);
    expect(review.requirements.length).toBeGreaterThan(0);
    expect(review.applicability.results.length).toBeGreaterThan(0);
    expect(review.traceability.metrics.totalRequirements).toBe(review.requirements.length);
    expect(review.compliance.steps).toHaveLength(WIZARD_STEP_IDS.length);
  });

  it('не подмешивает нормативное обогащение в экран проверки требований', () => {
    const review = buildWizardReview({ calculation });
    expect(review.requirements.every((req) => req.type !== 'regulatory')).toBe(true);
  });

  it('выбирает legacy-профиль по явному запросу и предупреждает об этом', () => {
    const review = buildWizardReview({
      calculation,
      standardProfileId: LEGACY_GOST34_PROFILE_ID,
    });

    expect(review.profile.id).toBe(LEGACY_GOST34_PROFILE_ID);
    expect(review.compliance.steps.find((s) => s.id === 'profile')?.status).toBe('attention');
  });

  it('учитывает ручное подтверждение применимости норматива', () => {
    const base = buildWizardReview({ calculation });
    const target = base.applicability.results.find((r) => r.finalStatus !== 'APPLICABLE');
    expect(target).toBeDefined();

    const confirmed = buildWizardReview({
      calculation,
      applicabilityOverrides: {
        [target!.standardId]: {
          status: 'APPLICABLE',
          confirmedBy: 'Архитектор',
          reason: 'Подтверждено Заказчиком',
        },
      },
    });

    const result = confirmed.applicability.results.find(
      (r) => r.standardId === target!.standardId,
    )!;
    expect(result.finalStatus).toBe('APPLICABLE');
    expect(result.confirmedBy).toBe('Архитектор');
    expect(confirmed.applicability.options[target!.standardId]).toBe(true);
  });

  it('сохраняет явное решение «не распределять» вопреки правилам сопоставления', () => {
    // Формулировка про испытания сопоставляется правилом с этапом аналитика.
    const rawRequirements = [
      {
        id: 'req-vendor-1',
        code: 'ТР-ВЕНД-01',
        category: 'functional' as const,
        title: 'Приёмочные испытания',
        description: 'Исполнитель должен провести приемочные испытания системы.',
      },
    ];

    const base = buildWizardReview({ calculation, rawRequirements });
    const ruleLinked = base.traceability.links.find((link) => link.method === 'RULE');
    expect(ruleLinked).toBeDefined();

    const rejected = buildWizardReview({
      calculation,
      rawRequirements,
      manualLinks: [
        {
          sourceId: ruleLinked!.sourceId,
          targetId: '',
          method: 'MANUAL' as const,
          confidence: 1,
          approved: true,
        },
      ],
    });

    expect(rejected.traceability.links.some((l) => l.sourceId === ruleLinked!.sourceId)).toBe(
      false,
    );
    expect(rejected.traceability.metrics.mappedRequirements).toBe(
      base.traceability.metrics.mappedRequirements - 1,
    );
  });

  it('не засчитывает связи удалённых требований в покрытие', () => {
    const review = buildWizardReview({
      calculation,
      manualLinks: [
        {
          sourceId: 'req-удалено',
          targetId: 'stage-1',
          method: 'MANUAL' as const,
          confidence: 1,
          approved: true,
        },
      ],
    });

    const { totalRequirements, mappedRequirements, unmappedRequirements } =
      review.traceability.metrics;
    expect(review.traceability.links.every((l) => l.sourceId !== 'req-удалено')).toBe(true);
    expect(mappedRequirements + unmappedRequirements).toBe(totalRequirements);
    expect(unmappedRequirements).toBeGreaterThanOrEqual(0);
  });

  it('засчитывает ручные связи трассировки', () => {
    const base = buildWizardReview({ calculation });
    const unmapped = base.traceability.metrics.unmappedRequirements;

    const linked = buildWizardReview({
      calculation,
      manualLinks: base.requirements.map((req) => ({
        sourceId: req.id,
        targetId: 'stage-1',
        method: 'MANUAL' as const,
        approved: true,
      })),
    });

    expect(linked.traceability.metrics.unmappedRequirements).toBeLessThanOrEqual(unmapped);
    expect(linked.traceability.metrics.coveragePercentage).toBe(100);
  });

  it('передаёт незаполненную основную надпись в блокирующие замечания', () => {
    const review = buildWizardReview({ calculation }, { ...FULL_SIGNATURES, approver: '' });
    expect(review.compliance.canExport).toBe(false);
    expect(review.compliance.blockingIssues.join(' ')).toContain('Утвердил от Исполнителя');
  });
});
