import { Gost34InputPayload, Gost34RequirementItem, Gost34Section } from '../types';
import { CONTEXT_GAP_PLACEHOLDER } from '../context/types';
import { toGost34RequirementItems } from '../requirements/adapters';

export function applyTraceabilityToRequirements(payload: Gost34InputPayload): Gost34InputPayload {
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

export function reconcileRenderedSections(
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
