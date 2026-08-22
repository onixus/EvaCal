import {
  Gost34DocMetadata,
  Gost34CalculationInput,
  Gost34StageItem,
  Gost34RiskItem,
} from './types';
import { safeJsonParse } from '../json';
import { Gost34RequirementV2, fromGost34RequirementItem } from './requirements';

export function normalizeMetadata(
  calc: Gost34CalculationInput | undefined,
  metadataOverride: Partial<Gost34DocMetadata> | undefined,
): Gost34DocMetadata {
  const currentYear = new Date().getFullYear();
  const systemName = calc?.name || 'Автоматизированная система расчёта трудозатрат';
  const customerName = calc?.customer || 'Заказчик';
  const docType = metadataOverride?.docType || 'TZ';

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

  return {
    ...defaultMeta,
    ...(metadataOverride || {}),
    signatures: {
      ...defaultMeta.signatures,
      ...(metadataOverride?.signatures || {}),
    },
  };
}

export function parseAnswers(calc: Gost34CalculationInput | undefined): Record<string, unknown> {
  if (!calc?.answers) return {};
  if (typeof calc.answers === 'string') {
    return safeJsonParse<Record<string, unknown>>(calc.answers, {});
  }
  return calc.answers;
}

export function normalizeStages(calc: Gost34CalculationInput | undefined): Gost34StageItem[] {
  return (calc?.stages || []).map((s, idx) => ({
    id: s.id || `stage-${idx}`,
    order: s.order ?? idx + 1,
    name: s.name || `Этап ${idx + 1}`,
    role: s.role || 'разработчик',
    hours: s.hours || 0,
    startDate: s.startDate ? new Date(s.startDate).toLocaleDateString('ru-RU') : undefined,
    endDate: s.endDate ? new Date(s.endDate).toLocaleDateString('ru-RU') : undefined,
    requirements: s.requirements || undefined,
  }));
}

export function normalizeRisks(calc: Gost34CalculationInput | undefined): Gost34RiskItem[] {
  return (calc?.risks || []).map((r, idx) => ({
    id: r.id || `risk-${idx}`,
    description: r.description || `Риск ${idx + 1}`,
    hours: r.hours || 0,
  }));
}

export function extractRequirementsFromStages(stages: Gost34StageItem[]): Gost34RequirementV2[] {
  const reqs: Gost34RequirementV2[] = [];
  let reqCounter = 1;

  stages.forEach((stg) => {
    if (stg.requirements && stg.requirements.trim().length > 0) {
      reqs.push(
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
          { sourceSection: stg.name },
        ),
      );
      reqCounter++;
    }
  });

  return reqs;
}

export function calculateTotals(
  stages: Gost34StageItem[],
  risks: Gost34RiskItem[],
  pmHours: number = 0,
) {
  const totalStageHours = stages.reduce((sum, s) => sum + s.hours, 0);
  const totalRiskHours = risks.reduce((sum, r) => sum + r.hours, 0);
  return totalStageHours + totalRiskHours + pmHours;
}
