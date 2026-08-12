import { analyzeAndNormalizeInput } from '../analyzer';
import { LEGACY_GOST34_PROFILE_ID } from '../standards';
import { getApplicabilitySummary, toEnrichmentOptions } from '../applicability/engine';
import { buildTraceability } from '../traceability/engine';
import { validateRequirements } from '../validation';
import { buildComplianceReport } from './compliance';
import type { WizardReviewInput, WizardReviewResult } from './types';

/**
 * Собирает всё, что показывают экраны проверки мастера (PR-10), из уже
 * существующих движков: нормализация входа → применимость → валидация →
 * трассировка → сводка соответствия.
 *
 * Функция ничего не генерирует и не пишет: экспорт документа выполняется
 * отдельным вызовом с теми же решениями пользователя.
 */
export function buildWizardReview(
  input: WizardReviewInput,
  signatures?: Record<string, string | undefined>,
): WizardReviewResult {
  const payload = analyzeAndNormalizeInput({
    calculation: input.calculation,
    rawRequirements: input.rawRequirements,
    vendorFiles: input.vendorFiles,
    projectContext: input.projectContext,
    metadataOverride: {
      standardProfileId: input.standardProfileId,
      /**
       * Обзор показывает требования пользователя, а не канцелярское
       * обогащение: применимость на этом шаге ещё подтверждается.
       */
      enrichRequirements: false,
      applicabilityOverrides: input.applicabilityOverrides,
    },
  });

  const requirements = payload.requirementsV2 || [];
  const stages = payload.stages || [];

  const applicabilityResults = payload.applicability || [];
  const traceability = buildTraceability(requirements, stages, input.manualLinks || []);
  const validation = payload.validation || validateRequirements(requirements);
  const contextGaps = payload.projectContext?.gaps || [];

  const profile = {
    id: payload.standardProfile.id,
    name: payload.standardProfile.name,
    version: payload.standardProfile.version,
    status: payload.standardProfile.status,
  };

  const applicabilitySummary = getApplicabilitySummary(applicabilityResults);

  return {
    profile,
    requirements,
    stages,
    validation,
    applicability: {
      results: applicabilityResults,
      summary: applicabilitySummary,
      options: toEnrichmentOptions(applicabilityResults) as Record<string, boolean>,
    },
    traceability,
    projectContext: payload.projectContext || {},
    contextGaps,
    compliance: buildComplianceReport({
      profile,
      isLegacyProfile: profile.id === LEGACY_GOST34_PROFILE_ID,
      requirementCount: requirements.length,
      validation,
      applicability: applicabilitySummary,
      traceability,
      signatures,
      contextGaps,
    }),
  };
}
