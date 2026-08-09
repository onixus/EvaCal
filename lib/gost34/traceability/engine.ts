import { fromGost34RequirementItem } from '../requirements/adapters';
import { Gost34RequirementV2, getRequirementEffectiveText } from '../requirements/v2';
import { Gost34RequirementItem, Gost34StageItem, Gost34TableData } from '../types';
import { TraceLink, TraceabilityResult } from './types';

export function buildTraceability(
  requirements: Gost34RequirementV2[],
  stages: Gost34StageItem[],
  manualLinks: TraceLink[] = [],
): TraceabilityResult {
  const stageIds = new Set(stages.map((stage) => stage.id));
  const links: TraceLink[] = manualLinks.filter((link) => stageIds.has(link.targetId));

  for (const req of requirements) {
    // Manual/pre-existing mappings are authoritative for this requirement.
    if (links.some((link) => link.sourceId === req.id)) continue;

    const matchedStage = matchStageByRules(req, stages);
    if (matchedStage) {
      links.push({
        sourceId: req.id,
        targetId: matchedStage.id,
        method: 'RULE',
        confidence: 0.8,
        approved: false,
      });
    }
  }

  const mappedRequirements = new Set(links.map((l) => l.sourceId)).size;
  const totalRequirements = requirements.length;
  const unmappedRequirements = totalRequirements - mappedRequirements;
  const coveragePercentage =
    totalRequirements > 0 ? (mappedRequirements / totalRequirements) * 100 : 0;

  return {
    links,
    metrics: {
      totalRequirements,
      mappedRequirements,
      unmappedRequirements,
      coveragePercentage: Number(coveragePercentage.toFixed(2)),
    },
  };
}

function matchStageByRules(
  req: Gost34RequirementV2,
  stages: Gost34StageItem[],
): Gost34StageItem | null {
  if (!stages || stages.length === 0) return null;

  const lowerDesc = `${req.title} ${getRequirementEffectiveText(req)}`.toLowerCase();

  if (/безопасн|152-фз|фстэк|авториз|права|шифр/i.test(lowerDesc)) {
    return stages.find((s) => /безопасн|защит|инженер/i.test(`${s.name} ${s.role}`)) || null;
  }
  if (/субд|бд|данны|postgresql|sqlite|схема/i.test(lowerDesc)) {
    return stages.find((s) => /бд|данн|архитект|разработ/i.test(`${s.name} ${s.role}`)) || null;
  }
  if (/интерфейс|веб|дизайн|экран|форма|wcag/i.test(lowerDesc)) {
    return (
      stages.find((s) => /интерфейс|фронт|разработ|дизайн/i.test(`${s.name} ${s.role}`)) || null
    );
  }
  if (/испытан|пми|приемк|тестиров/i.test(lowerDesc)) {
    return stages.find((s) => /тест|испытан|аналитик/i.test(`${s.name} ${s.role}`)) || null;
  }

  // No pseudo-random fallback. An unmatched requirement remains explicitly UNMAPPED.
  return null;
}

type TraceabilityRequirement = Gost34RequirementV2 | Gost34RequirementItem;

function isRequirementV2(requirement: TraceabilityRequirement): requirement is Gost34RequirementV2 {
  return 'approval' in requirement && typeof requirement.approval === 'object';
}

function normalizeRequirements(requirements: TraceabilityRequirement[]): Gost34RequirementV2[] {
  return requirements.map((requirement) =>
    isRequirementV2(requirement) ? requirement : fromGost34RequirementItem(requirement)
  );
}

function legacyManualLinks(
  requirements: TraceabilityRequirement[],
  stages: Gost34StageItem[]
): TraceLink[] {
  const stageIds = new Set(stages.map((stage) => stage.id));

  return requirements.flatMap((requirement) => {
    if (isRequirementV2(requirement)) return [];
    if (!requirement.mappedStageId || !stageIds.has(requirement.mappedStageId)) return [];

    return [
      {
        sourceId: requirement.id,
        targetId: requirement.mappedStageId,
        method: 'MANUAL' as const,
        confidence: 1,
        approved: true,
      },
    ];
  });
}

export function generateTraceabilityTable(
  requirements: TraceabilityRequirement[],
  stages: Gost34StageItem[],
  result?: TraceabilityResult,
): Gost34TableData {
  const normalizedRequirements = normalizeRequirements(requirements);
  const resolvedResult =
    result ?? buildTraceability(normalizedRequirements, stages, legacyManualLinks(requirements, stages));

  const rows: (string | number)[][] = [];

  for (const req of normalizedRequirements) {
    const link = resolvedResult.links.find((l) => l.sourceId === req.id);
    const stage = link ? stages.find((s) => s.id === link.targetId) : null;

    rows.push([
      req.code,
      req.title,
      stage ? stage.name : '[НЕ РАСПРЕДЕЛЕНО]',
      stage ? stage.role : '',
      req.source?.filename || 'ТЗ',
    ]);
  }

  return {
    caption: 'Таблица — Матрица прослеживаемости требований и этапов проекта',
    headers: [
      'Код требования',
      'Вендорское требование',
      'Ответственный этап работ',
      'Роль исполнителя',
      'Источник',
    ],
    rows,
  };
}
