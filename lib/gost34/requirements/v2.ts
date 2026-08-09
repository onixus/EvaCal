import type { StandardReference } from "../standards";
import type { RequirementCategory } from "../types";

// Re-exported rather than redeclared: a second copy of this union drifts.
export type { RequirementCategory } from "../types";

export type RequirementType =
  | "business"
  | "stakeholder"
  | "system"
  | "functional"
  | "nonfunctional"
  | "constraint"
  | "interface"
  | "data"
  | "regulatory";

export type RequirementStatus =
  "DRAFT" | "PROPOSED" | "APPROVED" | "REJECTED" | "SUPERSEDED";

export type VerificationMethod =
  "INSPECTION" | "ANALYSIS" | "DEMONSTRATION" | "TEST";

export type RequirementRelationType =
  | "DERIVES_FROM"
  | "REFINES"
  | "DEPENDS_ON"
  | "CONFLICTS_WITH"
  | "DUPLICATES"
  | "VERIFIED_BY"
  | "IMPLEMENTED_BY"
  | "TRACES_TO";

export interface RequirementSource {
  documentId?: string;
  filename?: string;
  page?: number;
  section?: string;
  paragraph?: string;
  locator?: string;
  hash?: string;
}

export interface RequirementApproval {
  status: RequirementStatus;
  approvedBy?: string;
  approvedAt?: string;
  rejectionReason?: string;
}

export interface RequirementRelation {
  targetRequirementId: string;
  type: RequirementRelationType;
  confidence?: number;
  approved?: boolean;
}

export interface Gost34RequirementV2 {
  id: string;
  code: string;
  category: RequirementCategory;
  type: RequirementType;
  title: string;

  /** Immutable source wording. Never overwrite with normalized or LLM-generated text. */
  originalText: string;

  /** Reviewed/normalized wording used by document generation after approval. */
  normalizedText?: string;

  source?: RequirementSource;

  verificationMethod?: VerificationMethod;
  acceptanceCriteria?: string[];

  approval: RequirementApproval;

  /** 0..1 confidence for machine-created proposals/mappings. */
  confidence?: number;

  standardReferences?: StandardReference[];
  relations?: RequirementRelation[];

  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;

  /**
   * Presentation-only fields carried over from Gost34RequirementItem so the
   * round trip through the adapters is lossless. Stage mapping moves into the
   * traceability model in PR-07; nothing new should be added here.
   */
  legacy?: {
    normalizedBy?: string;
    stageName?: string;
    stageRole?: string;
    mappedStageId?: string;
    mappedStageName?: string;
    mappedRole?: string;
  };
}

export function getRequirementEffectiveText(
  requirement: Gost34RequirementV2,
): string {
  if (
    requirement.approval.status === "APPROVED" &&
    requirement.normalizedText?.trim()
  ) {
    return requirement.normalizedText.trim();
  }

  return requirement.originalText.trim();
}

export function isRequirementApproved(
  requirement: Gost34RequirementV2,
): boolean {
  return requirement.approval.status === "APPROVED";
}
