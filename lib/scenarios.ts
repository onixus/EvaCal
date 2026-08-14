import { StageRow } from '@/components/StageTable';
import { RiskRow } from '@/components/TotalsSummary';
import { calculateCommercialSummary, CommercialConfig, CommercialSummary } from './commercial';

export type ScenarioType = 'optimistic' | 'base' | 'risk_buffer' | 'pessimistic';

export interface ScenarioDefinition {
  type: ScenarioType;
  label: string;
  shortLabel: string;
  description: string;
  badgeClass: string;
  hoursMultiplier: number;
  includeRisks: boolean;
  riskMultiplier: number;
  pmAllowanceMultiplier: number;
}

export const SCENARIO_DEFINITIONS: Record<ScenarioType, ScenarioDefinition> = {
  optimistic: {
    type: 'optimistic',
    label: 'Оптимистичный (Optimistic)',
    shortLabel: 'Оптимистичный',
    description:
      'Идеальные условия: риски исключены, быстрая обратная связь заказчика, сжатые сроки.',
    badgeClass: 'bg-emerald-100 text-emerald-800 dark:bg-nord-frost3/20 dark:text-nord-frost3',
    hoursMultiplier: 0.85,
    includeRisks: false,
    riskMultiplier: 0,
    pmAllowanceMultiplier: 0.8,
  },
  base: {
    type: 'base',
    label: 'Базовый (Base / Most Likely)',
    shortLabel: 'Базовый',
    description: 'Стандартная оценка по опроснику и шаблону с плановыми рисками.',
    badgeClass: 'bg-sky-100 text-sky-800 dark:bg-nord-frost2/20 dark:text-nord-frost2',
    hoursMultiplier: 1.0,
    includeRisks: true,
    riskMultiplier: 1.0,
    pmAllowanceMultiplier: 1.0,
  },
  risk_buffer: {
    type: 'risk_buffer',
    label: 'С буфером рисков (Risk-Buffer)',
    shortLabel: 'С буфером рисков',
    description:
      'Запас на интеграционные сложности, задержки доступов и согласования с регуляторами.',
    badgeClass: 'bg-amber-100 text-amber-800 dark:bg-nord-yellow/20 dark:text-nord-yellow',
    hoursMultiplier: 1.0,
    includeRisks: true,
    riskMultiplier: 1.5,
    pmAllowanceMultiplier: 1.2,
  },
  pessimistic: {
    type: 'pessimistic',
    label: 'Пессимистичный (Pessimistic)',
    shortLabel: 'Пессимистичный',
    description:
      'Стресс-сценарий: усложнение требований в процессе, двойные риски и расширенное РП.',
    badgeClass: 'bg-rose-100 text-rose-800 dark:bg-nord-auroraRed/20 dark:text-nord-auroraRed',
    hoursMultiplier: 1.25,
    includeRisks: true,
    riskMultiplier: 2.0,
    pmAllowanceMultiplier: 1.5,
  },
};

export interface ScenarioDiff {
  hours: number;
  hoursPercent: number;
  cost: number;
  costPercent: number;
  days: number;
}

export interface ScenarioResult {
  definition: ScenarioDefinition;
  stagesHours: number;
  pmHours: number;
  riskHours: number;
  totalLaborHours: number;
  durationBusinessDays: number;
  commercial: CommercialSummary;
  diffVsBase: ScenarioDiff;
  stages: StageRow[];
  risks: RiskRow[];
}

export interface ScenarioAnalysisResult {
  base: ScenarioResult;
  optimistic: ScenarioResult;
  risk_buffer: ScenarioResult;
  pessimistic: ScenarioResult;
  all: ScenarioResult[];
}

/**
 * Calculates labor hours and commercial metrics across 4 standard scenarios.
 */
export function calculateScenarioVariations(
  stages: StageRow[],
  pmHours: number,
  risks: RiskRow[],
  commercialConfig: CommercialConfig = {},
): ScenarioAnalysisResult {
  // First calculate base scenario
  const scenarioTypes: ScenarioType[] = ['optimistic', 'base', 'risk_buffer', 'pessimistic'];

  const resultsMap: Record<ScenarioType, ScenarioResult> = {} as any;

  // 1. Generate individual scenarios
  for (const type of scenarioTypes) {
    const def = SCENARIO_DEFINITIONS[type];

    // Compute stages for this scenario
    const scenarioStages: StageRow[] = stages.map((s) => ({
      ...s,
      hours: s.isApprovalTask ? 0 : Math.round(s.hours * def.hoursMultiplier * 10) / 10,
    }));

    const stagesHours = scenarioStages
      .filter((s) => !s.isApprovalTask)
      .reduce((sum, s) => sum + s.hours, 0);

    const scenarioPmHours = Math.round(pmHours * def.pmAllowanceMultiplier * 10) / 10;

    // Compute risks for this scenario
    const scenarioRisks: RiskRow[] = def.includeRisks
      ? risks.map((r) => ({
          ...r,
          hours: Math.round(r.hours * def.riskMultiplier * 10) / 10,
        }))
      : [];

    const riskHours = scenarioRisks.reduce((sum, r) => sum + r.hours, 0);
    const totalLaborHours = Math.round((stagesHours + scenarioPmHours + riskHours) * 10) / 10;
    const durationBusinessDays = Math.round((totalLaborHours / 8) * 10) / 10;

    const commercial = calculateCommercialSummary(
      scenarioStages,
      scenarioPmHours,
      scenarioRisks,
      commercialConfig,
    );

    resultsMap[type] = {
      definition: def,
      stagesHours,
      pmHours: scenarioPmHours,
      riskHours,
      totalLaborHours,
      durationBusinessDays,
      commercial,
      diffVsBase: { hours: 0, hoursPercent: 0, cost: 0, costPercent: 0, days: 0 },
      stages: scenarioStages,
      risks: scenarioRisks,
    };
  }

  // 2. Compute diffs relative to Base scenario
  const baseResult = resultsMap.base;

  for (const type of scenarioTypes) {
    const r = resultsMap[type];
    const hoursDiff = Math.round((r.totalLaborHours - baseResult.totalLaborHours) * 10) / 10;
    const hoursPercent =
      baseResult.totalLaborHours > 0
        ? Math.round((hoursDiff / baseResult.totalLaborHours) * 100)
        : 0;

    const costDiff = r.commercial.grandTotal - baseResult.commercial.grandTotal;
    const costPercent =
      baseResult.commercial.grandTotal > 0
        ? Math.round((costDiff / baseResult.commercial.grandTotal) * 100)
        : 0;

    const daysDiff =
      Math.round((r.durationBusinessDays - baseResult.durationBusinessDays) * 10) / 10;

    r.diffVsBase = {
      hours: hoursDiff,
      hoursPercent,
      cost: costDiff,
      costPercent,
      days: daysDiff,
    };
  }

  return {
    base: resultsMap.base,
    optimistic: resultsMap.optimistic,
    risk_buffer: resultsMap.risk_buffer,
    pessimistic: resultsMap.pessimistic,
    all: [resultsMap.optimistic, resultsMap.base, resultsMap.risk_buffer, resultsMap.pessimistic],
  };
}
