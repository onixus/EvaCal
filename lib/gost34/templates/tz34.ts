import { Gost34InputPayload, Gost34Section } from '../types';
import { buildProjectContext } from '../context/builder';
import { normalizeProjectContextForGeneration } from '../context/normalize';
import { ContextGap } from '../context/types';
import { LEGACY_GOST34_PROFILE_ID } from '../standards';
import { renderDocumentSchema, validateSchemaCoverage } from '../schema/renderer';
import { SchemaValidationIssue } from '../schema/types';
import { TZ_SCHEMA_2020 } from '../schema/tz34-2020';
import { buildTZ34LegacySections } from './tz34-legacy89';
import { applyTraceabilityToRequirements, reconcileRenderedSections } from './tz34Helpers';

export interface TZ34BuildResult {
  sections: Gost34Section[];
  gaps: ContextGap[];
  issues: SchemaValidationIssue[];
}

export function buildTZ34Document(payload: Gost34InputPayload): TZ34BuildResult {
  const effectivePayload = applyTraceabilityToRequirements(payload);

  if (effectivePayload.standardProfile.id === LEGACY_GOST34_PROFILE_ID) {
    return { sections: buildTZ34LegacySections(effectivePayload), gaps: [], issues: [] };
  }

  const rawContext =
    effectivePayload.projectContext ||
    buildProjectContext({
      systemName: effectivePayload.systemName,
      customerName: effectivePayload.customerName,
      answers: effectivePayload.answers,
      stages: effectivePayload.stages,
      risks: effectivePayload.risks,
      requirements: effectivePayload.customRequirements,
      totalLaborHours: effectivePayload.totalLaborHours,
      vendorSourceFiles: effectivePayload.vendorSourceFiles,
    });

  const context = normalizeProjectContextForGeneration(rawContext, effectivePayload.stages);
  const rendered = renderDocumentSchema(TZ_SCHEMA_2020, {
    payload: effectivePayload,
    context,
    schema: TZ_SCHEMA_2020,
  });
  const coverageIssues = validateSchemaCoverage(TZ_SCHEMA_2020, rendered.sections);
  const sections = reconcileRenderedSections(rendered.sections, effectivePayload);

  return {
    sections,
    gaps: rendered.gaps,
    issues: [...rendered.issues, ...coverageIssues],
  };
}

export function buildTZ34Sections(payload: Gost34InputPayload): Gost34Section[] {
  return buildTZ34Document(payload).sections;
}
