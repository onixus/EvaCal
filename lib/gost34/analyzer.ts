import {
  Gost34InputPayload,
  Gost34DocMetadata,
  Gost34RequirementItem,
  Gost34StageItem,
  Gost34RiskItem,
  GostDocumentType,
} from './types';
import { getEnrichedGostRequirements } from './enricher';
import { resolveGost34Profile } from './standards';
import {
  Gost34RequirementV2,
  fromGost34RequirementItem,
  fromGost34RequirementItems,
  toGost34RequirementItems,
} from './requirements';
import { buildProjectContext } from './context/builder';
import { ProjectContext } from './context/types';

/**
 * Normalizes input from EvaCal Calculation model or direct external API input
 * into a structured payload for GOST 34 generator.
 */
export function analyzeAndNormalizeInput(input: {
  calculation?: {
    id: string;
    name: string;
    customer: string;
    answers?: string | Record<string, any>;
    pmHours?: number;
    startDate?: Date | string;
    stages?: any[];
    risks?: any[];
    template?: {
      name: string;
      description?: string | null;
      workDayHours?: number;
      includeWeekends?: boolean;
    };
  };
  metadataOverride?: Partial<Gost34DocMetadata>;
  rawRequirements?: Gost34RequirementItem[];
  vendorFiles?: string[];
  /** Ручной ввод проектного контекста: перекрывает данные опросника и расчёта. */
  projectContext?: Partial<ProjectContext>;
}): Gost34InputPayload {
  const calc = input.calculation;

  const currentYear = new Date().getFullYear();
  const systemName = calc?.name || 'Автоматизированная система расчёта трудозатрат';
  const customerName = calc?.customer || 'Заказчик';
  const docType: GostDocumentType = input.metadataOverride?.docType || 'TZ';

  const defaultMeta: Gost34DocMetadata = {
    docType,
    systemName,
    fullSystemName: `Автоматизированная система «${systemName}»`,
    documentCode: `АБВГ.${(calc?.id || '001').substring(0, 6).toUpperCase()}.${docType}`,
    contractNumber: 'Договор № 01-ГС/2026',
    customerName,
    developerName: 'ООО «Исполнитель»',
    signatures: {
      developer: 'Иванов А.В.',
      checker: 'Петров С.Н.',
      techControl: 'Сидоров К.М.',
      normControl: 'Васильева Е.И.',
      approver: 'Михайлов Д.П.',
      customerApprover: 'Александров И.В.',
      invSubl: 'ИНВ-102938',
      signDate: '06.08.2026',
    },
    city: 'Москва',
    year: currentYear,
    version: '1.0',
    enrichRequirements: true,
  };

  const metadata: Gost34DocMetadata = {
    ...defaultMeta,
    ...(input.metadataOverride || {}),
    signatures: {
      ...defaultMeta.signatures,
      ...(input.metadataOverride?.signatures || {}),
    },
  };

  const standardProfile = resolveGost34Profile(metadata.standardProfileId);

  // Parse answers if JSON string
  let parsedAnswers: Record<string, any> = {};
  if (calc?.answers) {
    if (typeof calc.answers === 'string') {
      try {
        parsedAnswers = JSON.parse(calc.answers);
      } catch (e) {
        parsedAnswers = {};
      }
    } else {
      parsedAnswers = calc.answers;
    }
  }

  // Normalize stages
  const stages: Gost34StageItem[] = (calc?.stages || []).map((s, idx) => ({
    id: s.id || `stage-${idx}`,
    order: s.order ?? idx + 1,
    name: s.name || `Этап ${idx + 1}`,
    role: s.role || 'разработчик',
    hours: s.hours || 0,
    startDate: s.startDate ? new Date(s.startDate).toLocaleDateString('ru-RU') : undefined,
    endDate: s.endDate ? new Date(s.endDate).toLocaleDateString('ru-RU') : undefined,
    requirements: s.requirements || undefined,
  }));

  // Normalize risks
  const risks: Gost34RiskItem[] = (calc?.risks || []).map((r, idx) => ({
    id: r.id || `risk-${idx}`,
    description: r.description || `Риск ${idx + 1}`,
    hours: r.hours || 0,
  }));

  // Extract explicit functional and technical requirements from stage requirements
  const requirementsV2: Gost34RequirementV2[] = [];
  let reqCounter = 1;

  stages.forEach((stg) => {
    if (stg.requirements && stg.requirements.trim().length > 0) {
      requirementsV2.push(
        fromGost34RequirementItem(
          {
            id: `req-${reqCounter}`,
            code: `ТР-ЭТ-${String(reqCounter).padStart(2, '0')}`,
            category: 'functional',
            title: `Требования к этапу «${stg.name}»`,
            description: stg.requirements,
            stageName: stg.name,
            stageRole: stg.role,
          },
          { sourceSection: stg.name }
        )
      );
      reqCounter++;
    }
  });

  requirementsV2.push(...fromGost34RequirementItems(input.rawRequirements || []));

  // Apply normative enrichment if flag is active
  if (metadata.enrichRequirements) {
    // Canned regulatory text, not a machine proposal — it needs no review.
    requirementsV2.push(
      ...fromGost34RequirementItems(getEnrichedGostRequirements(metadata.enrichmentOptions), {
        type: 'regulatory',
        status: 'APPROVED',
      })
    );
  }

  const customRequirements = toGost34RequirementItems(requirementsV2, { preferNormalized: true });

  const totalStageHours = stages.reduce((sum, s) => sum + s.hours, 0);
  const totalRiskHours = risks.reduce((sum, r) => sum + r.hours, 0);
  const pmHours = calc?.pmHours || 0;
  const totalLaborHours = totalStageHours + totalRiskHours + pmHours;

  const projectContext = buildProjectContext({
    systemName,
    customerName,
    answers: parsedAnswers,
    stages,
    risks,
    requirements: customRequirements,
    totalLaborHours,
    vendorSourceFiles: input.vendorFiles || [],
    override: input.projectContext,
  });

  return {
    metadata,
    standardProfile,
    systemName,
    customerName,
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
  };
}
