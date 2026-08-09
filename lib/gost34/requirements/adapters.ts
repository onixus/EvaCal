import type { Gost34RequirementItem } from "../types";
import {
  Gost34RequirementV2,
  RequirementStatus,
  RequirementType,
  getRequirementEffectiveText,
} from "./v2";

export interface ToItemOptions {
  /**
   * Use `normalizedText` for `description` even when the requirement is not
   * approved yet. Needed on pipeline stages that clean or rewrite text before
   * anybody has reviewed it — without it the effective text falls back to the
   * original and the cleaning is silently discarded.
   */
  preferNormalized?: boolean;
}

export interface FromItemOptions {
  status?: RequirementStatus;
  type?: RequirementType;
  /** Filename to record as the source when the item carries none. */
  sourceFilename?: string;
  /** Section/paragraph the requirement was taken from. */
  sourceSection?: string;
}

/** Codes produced by the regulatory enricher rather than by a project source. */
function inferRequirementType(item: Gost34RequirementItem): RequirementType {
  return item.code?.startsWith("ТР-ГОСТ") ? "regulatory" : "system";
}

export function toGost34RequirementItem(
  requirement: Gost34RequirementV2,
  opts: ToItemOptions = {},
): Gost34RequirementItem {
  const description = opts.preferNormalized
    ? requirement.normalizedText?.trim() || requirement.originalText.trim()
    : getRequirementEffectiveText(requirement);

  const item: Gost34RequirementItem = {
    id: requirement.id,
    code: requirement.code,
    category: requirement.category,
    title: requirement.title,
    description,
    originalText: requirement.originalText,
  };

  if (requirement.source?.filename !== undefined)
    item.sourceFile = requirement.source.filename;
  if (requirement.legacy?.normalizedBy !== undefined)
    item.normalizedBy = requirement.legacy.normalizedBy;
  if (requirement.legacy?.stageName !== undefined)
    item.stageName = requirement.legacy.stageName;
  if (requirement.legacy?.stageRole !== undefined)
    item.stageRole = requirement.legacy.stageRole;
  if (requirement.legacy?.mappedStageId !== undefined)
    item.mappedStageId = requirement.legacy.mappedStageId;
  if (requirement.legacy?.mappedStageName !== undefined)
    item.mappedStageName = requirement.legacy.mappedStageName;
  if (requirement.legacy?.mappedRole !== undefined)
    item.mappedRole = requirement.legacy.mappedRole;

  return item;
}

export function fromGost34RequirementItem(
  item: Gost34RequirementItem,
  opts: FromItemOptions = {},
): Gost34RequirementV2 {
  // Never overwrite an original that survived an earlier conversion.
  const originalText = item.originalText ?? item.description;

  const requirement: Gost34RequirementV2 = {
    id: item.id,
    code: item.code,
    category: item.category,
    type: opts.type ?? inferRequirementType(item),
    title: item.title,
    originalText,
    approval: { status: opts.status ?? "DRAFT" },
  };

  if (item.description !== originalText)
    requirement.normalizedText = item.description;

  const filename = item.sourceFile ?? opts.sourceFilename;
  if (filename !== undefined || opts.sourceSection !== undefined) {
    requirement.source = {};
    if (filename !== undefined) requirement.source.filename = filename;
    if (opts.sourceSection !== undefined)
      requirement.source.section = opts.sourceSection;
  }

  const legacy: NonNullable<Gost34RequirementV2["legacy"]> = {};
  if (item.normalizedBy !== undefined) legacy.normalizedBy = item.normalizedBy;
  if (item.stageName !== undefined) legacy.stageName = item.stageName;
  if (item.stageRole !== undefined) legacy.stageRole = item.stageRole;
  if (item.mappedStageId !== undefined)
    legacy.mappedStageId = item.mappedStageId;
  if (item.mappedStageName !== undefined)
    legacy.mappedStageName = item.mappedStageName;
  if (item.mappedRole !== undefined) legacy.mappedRole = item.mappedRole;
  if (Object.keys(legacy).length > 0) requirement.legacy = legacy;

  return requirement;
}

export function toGost34RequirementItems(
  requirements: Gost34RequirementV2[],
  opts: ToItemOptions = {},
): Gost34RequirementItem[] {
  return requirements.map((r) => toGost34RequirementItem(r, opts));
}

export function fromGost34RequirementItems(
  items: Gost34RequirementItem[],
  opts: FromItemOptions = {},
): Gost34RequirementV2[] {
  return items.map((item) => fromGost34RequirementItem(item, opts));
}
