/**
 * Слепок контрольного документа: то, что должно оставаться стабильным между
 * выпусками. Текст разделов в слепок не входит намеренно — иначе каждая правка
 * формулировки требовала бы обновления всех девяти эталонов и перестала бы
 * читаться в ревью. Фиксируются структура, состав и решения движков.
 */

import { analyzeAndNormalizeInput } from '../../analyzer';
import { buildGost34DocumentAST } from '../../generator';
import type { Gost34Section } from '../../types';
import type { GoldenScenario } from './scenarios';

export interface GoldenSectionSnapshot {
  numStr: string;
  title: string;
  /** Число абзацев: рост или пропажа содержимого раздела видны сразу. */
  paragraphs: number;
  tables?: string[];
  subsections?: GoldenSectionSnapshot[];
}

export interface GoldenSnapshot {
  scenario: string;
  title: string;
  docType: string;
  profile: { id: string; version: string; primaryStandard: string };
  sections: GoldenSectionSnapshot[];
  requirementCodes: string[];
  applicability: Record<string, string>;
  validation: { ERROR: number; WARNING: number; INFO: number };
  traceabilityCoveragePercent: number;
  contextGapPaths: string[];
  schemaIssues: { nodeId: string; kind: string }[];
}

function snapshotSections(sections: Gost34Section[]): GoldenSectionSnapshot[] {
  return sections.map((section) => {
    const snapshot: GoldenSectionSnapshot = {
      numStr: section.numStr,
      title: section.title,
      paragraphs: section.paragraphs.length,
    };
    const captions = (section.tables || []).map(
      (table, idx) => table.caption || `таблица ${idx + 1}`,
    );
    if (captions.length > 0) snapshot.tables = captions;
    if (section.subsections?.length) {
      snapshot.subsections = snapshotSections(section.subsections);
    }
    return snapshot;
  });
}

export function buildGoldenSnapshot(scenario: GoldenScenario): GoldenSnapshot {
  const payload = analyzeAndNormalizeInput({
    calculation: scenario.calculation,
    projectContext: scenario.projectContext,
    metadataOverride: {
      docType: scenario.docType,
      standardProfileId: scenario.standardProfileId,
      enrichRequirements: true,
    },
  });
  const ast = buildGost34DocumentAST(payload);

  const applicability: Record<string, string> = {};
  for (const result of payload.applicability || []) {
    applicability[result.standardId] = result.finalStatus;
  }

  return {
    scenario: scenario.id,
    title: scenario.title,
    docType: scenario.docType,
    profile: {
      id: payload.standardProfile.id,
      version: payload.standardProfile.version,
      primaryStandard: payload.standardProfile.citations.primary,
    },
    sections: snapshotSections(ast.sections),
    requirementCodes: (payload.customRequirements || []).map((req) => req.code),
    applicability,
    validation: {
      ERROR: payload.validation?.counts.ERROR ?? 0,
      WARNING: payload.validation?.counts.WARNING ?? 0,
      INFO: payload.validation?.counts.INFO ?? 0,
    },
    traceabilityCoveragePercent: payload.traceability?.metrics.coveragePercentage ?? 0,
    contextGapPaths: (payload.projectContext?.gaps || []).map((gap) => gap.path),
    schemaIssues: ast.diagnostics.issues.map((issue) => ({
      nodeId: issue.nodeId,
      kind: issue.kind,
    })),
  };
}
