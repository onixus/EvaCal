import {
  Gost34RequirementV2,
  getRequirementEffectiveText,
} from "../requirements/v2";
import { Gost34StageItem, Gost34TableData } from "../types";
import { TraceLink, TraceabilityResult } from "./types";

export function buildTraceability(
  requirements: Gost34RequirementV2[],
  stages: Gost34StageItem[],
  manualLinks: TraceLink[] = [],
): TraceabilityResult {
  const links: TraceLink[] = [...manualLinks];

  for (const req of requirements) {
    // Skip if already mapped manually
    if (links.some((link) => link.sourceId === req.id)) continue;

    const matchedStage = matchStageByRules(req, stages);
    if (matchedStage) {
      links.push({
        sourceId: req.id,
        targetId: matchedStage.id,
        method: "RULE",
        confidence: 0.8, // Basic keyword rule match
        approved: false, // Rule matches should be manually approved
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

  const lowerDesc =
    `${req.title} ${getRequirementEffectiveText(req)}`.toLowerCase();

  // Match keywords to stage names or roles
  if (/безопасн|152-фз|фстэк|авториз|права|шифр/i.test(lowerDesc)) {
    return (
      stages.find((s) =>
        /безопасн|защит|инженер/i.test(`${s.name} ${s.role}`),
      ) || null
    );
  }
  if (/субд|бд|данны|postgresql|sqlite|схема/i.test(lowerDesc)) {
    return (
      stages.find((s) =>
        /бд|данн|архитект|разработ/i.test(`${s.name} ${s.role}`),
      ) || null
    );
  }
  if (/интерфейс|веб|дизайн|экран|форма|wcag/i.test(lowerDesc)) {
    return (
      stages.find((s) =>
        /интерфейс|фронт|разработ|дизайн/i.test(`${s.name} ${s.role}`),
      ) || null
    );
  }
  if (/испытан|пми|приемк|тестиров/i.test(lowerDesc)) {
    return (
      stages.find((s) =>
        /тест|испытан|аналитик/i.test(`${s.name} ${s.role}`),
      ) || null
    );
  }

  // Fallback removed - if it doesn't match, it returns null and gets UNMAPPED state
  return null;
}

export function generateTraceabilityTable(
  requirements: Gost34RequirementV2[],
  stages: Gost34StageItem[],
  result: TraceabilityResult,
): Gost34TableData {
  const rows: (string | number)[][] = [];

  for (const req of requirements) {
    const link = result.links.find((l) => l.sourceId === req.id);
    const stage = link ? stages.find((s) => s.id === link.targetId) : null;

    rows.push([
      req.code,
      req.title,
      stage ? stage.name : "[НЕ РАСПРЕДЕЛЕНО]",
      stage ? stage.role : "",
      req.source?.filename || "ТЗ",
    ]);
  }

  return {
    caption: "Таблица — Матрица прослеживаемости требований и этапов проекта",
    headers: [
      "Код требования",
      "Вендорское требование",
      "Ответственный этап работ",
      "Роль исполнителя",
      "Источник",
    ],
    rows,
  };
}
