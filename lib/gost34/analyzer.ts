import {
  Gost34InputPayload,
  Gost34DocMetadata,
  Gost34RequirementItem,
  Gost34CalculationInput,
} from './types';
import { getEnrichedGostRequirements } from './enricher';
import { resolveGost34Profile } from './standards';
import {
  Gost34RequirementV2,
  fromGost34RequirementItems,
  toGost34RequirementItems,
} from './requirements';
import { buildProjectContext } from './context/builder';
import { ProjectContext } from './context/types';
import { validateRequirements } from './validation';
import { evaluateApplicability } from './applicability';
import { buildTraceability } from './traceability/engine';
import type { TraceLink } from './traceability/types';
import {
  normalizeMetadata,
  parseAnswers,
  normalizeStages,
  normalizeRisks,
  extractRequirementsFromStages,
  calculateTotals,
} from './analyzerHelpers';

/**
 * Normalizes input from EvaCal Calculation model or direct external API input
 * into a structured payload for GOST 34 generator.
 */
export function analyzeAndNormalizeInput(input: {
  calculation?: Gost34CalculationInput;
  metadataOverride?: Partial<Gost34DocMetadata>;
  rawRequirements?: Gost34RequirementItem[];
  vendorFiles?: string[];
  /** Ручной ввод проектного контекста: перекрывает данные опросника и расчёта. */
  projectContext?: Partial<ProjectContext>;
  /**
   * Подтверждённые в мастере связи «требование → этап». Имеют приоритет над
   * автоматическим сопоставлением: документ печатает именно их.
   */
  manualTraceLinks?: TraceLink[];
}): Gost34InputPayload {
  const calc = input.calculation;

  const metadata = normalizeMetadata(calc, input.metadataOverride);
  const standardProfile = resolveGost34Profile(metadata.standardProfileId);
  const parsedAnswers = parseAnswers(calc);
  const stages = normalizeStages(calc);
  const risks = normalizeRisks(calc);
  const pmHours = calc?.pmHours || 0;
  const totalLaborHours = calculateTotals(stages, risks, pmHours);

  const requirementsV2: Gost34RequirementV2[] = extractRequirementsFromStages(stages);
  requirementsV2.push(...fromGost34RequirementItems(input.rawRequirements || []));

  const baseCustomRequirements = toGost34RequirementItems(requirementsV2, {
    preferNormalized: true,
  });

  const projectContext = buildProjectContext({
    systemName: metadata.systemName,
    customerName: metadata.customerName,
    answers: parsedAnswers,
    stages,
    risks,
    requirements: baseCustomRequirements,
    totalLaborHours,
    vendorSourceFiles: input.vendorFiles || [],
    override: input.projectContext,
  });

  // Ручные подтверждения мастера имеют приоритет над булевыми флагами обогащения.
  const enrichmentDecisions = {
    ...(metadata.enrichmentOptions || {}),
    ...(metadata.applicabilityOverrides || {}),
  };
  const applicability = evaluateApplicability(projectContext, enrichmentDecisions);

  // Apply normative enrichment if flag is active
  if (metadata.enrichRequirements) {
    const enriched = getEnrichedGostRequirements(
      metadata.enrichmentOptions,
      projectContext,
      enrichmentDecisions,
    );
    requirementsV2.push(
      ...fromGost34RequirementItems(enriched, {
        type: 'regulatory',
        status: 'APPROVED',
      }),
    );
  }

  const customRequirements = toGost34RequirementItems(requirementsV2, {
    preferNormalized: true,
  });

  return {
    metadata,
    standardProfile,
    systemName: metadata.systemName,
    customerName: metadata.customerName,
    templateName: calc?.template?.name,
    answers: parsedAnswers,
    stages,
    risks,
    pmHours,
    totalLaborHours,
    customRequirements,
    requirementsV2,
    vendorSourceFiles: input.vendorFiles || [],
    projectContext,
    applicability,
    validation: validateRequirements(requirementsV2),
    traceability: buildTraceability(requirementsV2, stages, input.manualTraceLinks || []),
  };
}
