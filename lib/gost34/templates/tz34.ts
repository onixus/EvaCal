import { Gost34InputPayload, Gost34Section } from '../types';
import { buildProjectContext } from '../context/builder';
import { ContextGap } from '../context/types';
import { LEGACY_GOST34_PROFILE_ID } from '../standards';
import { renderDocumentSchema, validateSchemaCoverage } from '../schema/renderer';
import { SchemaValidationIssue } from '../schema/types';
import { TZ_SCHEMA_2020 } from '../schema/tz34-2020';
import { buildTZ34LegacySections } from './tz34-legacy89';

export interface TZ34BuildResult {
  sections: Gost34Section[];
  /** Сведения проектного контекста, требующие уточнения. */
  gaps: ContextGap[];
  /** Нарушения структуры документа относительно профиля. */
  issues: SchemaValidationIssue[];
}

/**
 * Строит ТЗ по нормативному профилю из payload: действующий профиль —
 * schema-driven структура ГОСТ 34.602-2020 на проектном контексте,
 * legacy-профиль — прежний документ по ГОСТ 34.602-89 без изменений.
 */
export function buildTZ34Document(payload: Gost34InputPayload): TZ34BuildResult {
  if (payload.standardProfile.id === LEGACY_GOST34_PROFILE_ID) {
    return { sections: buildTZ34LegacySections(payload), gaps: [], issues: [] };
  }

  const context =
    payload.projectContext ||
    buildProjectContext({
      systemName: payload.systemName,
      customerName: payload.customerName,
      answers: payload.answers,
      stages: payload.stages,
      risks: payload.risks,
      requirements: payload.customRequirements,
      totalLaborHours: payload.totalLaborHours,
      vendorSourceFiles: payload.vendorSourceFiles,
    });

  const rendered = renderDocumentSchema(TZ_SCHEMA_2020, { payload, context, schema: TZ_SCHEMA_2020 });
  const coverageIssues = validateSchemaCoverage(TZ_SCHEMA_2020, rendered.sections);

  return {
    sections: rendered.sections,
    gaps: rendered.gaps,
    issues: [...rendered.issues, ...coverageIssues],
  };
}

export function buildTZ34Sections(payload: Gost34InputPayload): Gost34Section[] {
  return buildTZ34Document(payload).sections;
}
