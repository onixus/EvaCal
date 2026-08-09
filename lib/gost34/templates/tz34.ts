import { Gost34InputPayload, Gost34RequirementItem, Gost34Section } from '../types';
import { buildProjectContext } from '../context/builder';
import { normalizeProjectContextForGeneration } from '../context/normalize';
import { CONTEXT_GAP_PLACEHOLDER, ContextGap } from '../context/types';
import { toGost34RequirementItems } from '../requirements/adapters';
import { LEGACY_GOST34_PROFILE_ID } from '../standards';
import { renderDocumentSchema, validateSchemaCoverage } from '../schema/renderer';
import { SchemaValidationIssue } from '../schema/types';
import { TZ_SCHEMA_2020 } from '../schema/tz34-2020';
import { buildTZ34LegacySections } from './tz34-legacy89';

export interface TZ34BuildResult {
  sections: Gost34Section[];
  gaps: ContextGap[];
  issues: SchemaValidationIssue[];
}

function applyTraceabilityToRequirements(payload: Gost34InputPayload): Gost34InputPayload {
  const sourceRequirements: Gost34RequirementItem[] = payload.customRequirements?.length
    ? payload.customRequirements
    : payload.requirementsV2?.length
      ? toGost34RequirementItems(payload.requirementsV2)
      : [];

  if (sourceRequirements.length === 0) return payload;

  const stagesById = new Map(payload.stages.map((stage) => [stage.id, stage]));
  const linksByRequirementId = new Map(
    (payload.traceability?.links || [])
      .filter((link) => stagesById.has(link.targetId))
      .map((link) => [link.sourceId, link]),
  );

  const customRequirements = sourceRequirements.map((requirement) => {
    const link = linksByRequirementId.get(requirement.id);
    if (!link) return requirement;

    const stage = stagesById.get(link.targetId)!;
    return {
      ...requirement,
      mappedStageId: stage.id,
      mappedStageName: stage.name,
      mappedRole: stage.role,
    };
  });

  return { ...payload, customRequirements };
}

function reconcileRenderedSections(
  sections: Gost34Section[],
  payload: Gost34InputPayload,
): Gost34Section[] {
  if (payload.stages.length > 0) return sections;

  return sections.map((section) => {
    if (section.id !== 'tz2020-work-scope') return section;

    return {
      ...section,
      paragraphs: section.paragraphs.map((paragraph) =>
        paragraph.includes(
          'Перечень стадий и этапов работ, их содержание и трудоёмкость приведены в таблице',
        )
          ? `${section.numStr}.1 Состав стадий и этапов работ — ${CONTEXT_GAP_PLACEHOLDER}.`
          : paragraph,
      ),
    };
  });
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
