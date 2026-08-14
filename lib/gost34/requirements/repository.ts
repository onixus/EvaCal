import {
  Gost34RequirementV2,
  RequirementCategory,
  RequirementStatus,
  RequirementType,
  getRequirementEffectiveText,
  isRequirementApproved,
} from './v2';
import { fromGost34RequirementItem } from './adapters';
import { Gost34RequirementItem, Gost34Section } from '../types';
import { resolveGostSection } from '../traceability/matrix';

export interface DuplicateMatch {
  item1: Gost34RequirementV2;
  item2: Gost34RequirementV2;
  similarity: number;
}

export interface RelationValidationError {
  requirementId: string;
  requirementCode: string;
  missingTargetId: string;
  relationType: string;
}

/**
 * Calculates text similarity score (0..1) using bigram Jaccard index.
 */
function calculateTextSimilarity(a: string, b: string): number {
  const normA = a.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ' ').trim();
  const normB = b.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ' ').trim();

  if (normA === normB) return 1.0;
  if (!normA || !normB) return 0.0;

  const getBigrams = (str: string): Set<string> => {
    const s = new Set<string>();
    for (let i = 0; i < str.length - 1; i++) {
      s.add(str.substring(i, i + 2));
    }
    return s;
  };

  const setA = getBigrams(normA);
  const setB = getBigrams(normB);

  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Domain Requirements Repository (Horizon B2).
 * Serves as the single Source of Truth for all functional and regulatory requirements.
 */
export class RequirementsRepository {
  private items: Map<string, Gost34RequirementV2> = new Map();

  constructor(initial: (Gost34RequirementV2 | Gost34RequirementItem)[] = []) {
    for (const item of initial) {
      if ('approval' in item) {
        this.items.set(item.id, { ...item });
      } else {
        const v2 = fromGost34RequirementItem(item, { status: 'APPROVED' });
        this.items.set(v2.id, v2);
      }
    }
  }

  /**
   * Adds a new requirement into the repository.
   */
  public add(
    req: Partial<Gost34RequirementV2> & { title: string; originalText: string },
  ): Gost34RequirementV2 {
    const id = req.id || `req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const code = req.code || `ТР-${this.items.size + 1}`;

    const newReq: Gost34RequirementV2 = {
      id,
      code,
      category: req.category || 'functional',
      type: req.type || 'system',
      title: req.title.trim(),
      originalText: req.originalText.trim(),
      normalizedText: req.normalizedText?.trim(),
      source: req.source,
      verificationMethod: req.verificationMethod || 'TEST',
      acceptanceCriteria: req.acceptanceCriteria || [],
      approval: req.approval || { status: 'DRAFT' },
      confidence: req.confidence ?? 1.0,
      standardReferences: req.standardReferences || [],
      relations: req.relations || [],
      createdBy: req.createdBy || 'architect',
      createdAt: req.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.items.set(id, newReq);
    return newReq;
  }

  /**
   * Fetches a requirement by ID.
   */
  public get(id: string): Gost34RequirementV2 | undefined {
    return this.items.get(id);
  }

  /**
   * Returns all requirements in the repository.
   */
  public getAll(): Gost34RequirementV2[] {
    return Array.from(this.items.values());
  }

  /**
   * Returns requirements filtered by category.
   */
  public getByCategory(category: RequirementCategory): Gost34RequirementV2[] {
    return this.getAll().filter((r) => r.category === category);
  }

  /**
   * Returns requirements filtered by approval status.
   */
  public getByStatus(status: RequirementStatus): Gost34RequirementV2[] {
    return this.getAll().filter((r) => r.approval.status === status);
  }

  /**
   * Returns only approved requirements.
   */
  public getApproved(): Gost34RequirementV2[] {
    return this.getAll().filter(isRequirementApproved);
  }

  /**
   * Updates an existing requirement.
   */
  public update(id: string, patch: Partial<Gost34RequirementV2>): Gost34RequirementV2 {
    const existing = this.items.get(id);
    if (!existing) {
      throw new Error(`Requirement with ID ${id} not found in repository`);
    }

    const updated: Gost34RequirementV2 = {
      ...existing,
      ...patch,
      id: existing.id, // ID is immutable
      originalText: existing.originalText, // Original text is immutable
      updatedAt: new Date().toISOString(),
    };

    this.items.set(id, updated);
    return updated;
  }

  /**
   * Deletes a requirement by ID.
   */
  public remove(id: string): boolean {
    return this.items.delete(id);
  }

  /**
   * Approves a requirement.
   */
  public approve(id: string, approvedBy: string = 'architect'): Gost34RequirementV2 {
    const req = this.items.get(id);
    if (!req) throw new Error(`Requirement with ID ${id} not found`);

    req.approval = {
      status: 'APPROVED',
      approvedBy,
      approvedAt: new Date().toISOString(),
    };
    req.updatedAt = new Date().toISOString();

    return req;
  }

  /**
   * Rejects a requirement with a reason.
   */
  public reject(id: string, rejectionReason: string): Gost34RequirementV2 {
    const req = this.items.get(id);
    if (!req) throw new Error(`Requirement with ID ${id} not found`);

    req.approval = {
      status: 'REJECTED',
      rejectionReason,
      approvedAt: new Date().toISOString(),
    };
    req.updatedAt = new Date().toISOString();

    return req;
  }

  /**
   * Detects duplicate or highly overlapping requirements.
   */
  public findDuplicates(threshold: number = 0.7): DuplicateMatch[] {
    const all = this.getAll();
    const duplicates: DuplicateMatch[] = [];

    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const item1 = all[i];
        const item2 = all[j];

        const text1 = `${item1.title} ${getRequirementEffectiveText(item1)}`;
        const text2 = `${item2.title} ${getRequirementEffectiveText(item2)}`;

        const similarity = calculateTextSimilarity(text1, text2);
        if (similarity >= threshold) {
          duplicates.push({ item1, item2, similarity: Number(similarity.toFixed(2)) });
        }
      }
    }

    return duplicates;
  }

  /**
   * Validates cross-requirement references and dependencies.
   */
  public validateRelations(): RelationValidationError[] {
    const errors: RelationValidationError[] = [];
    const ids = new Set(this.items.keys());

    for (const req of this.items.values()) {
      if (!req.relations) continue;
      for (const rel of req.relations) {
        if (!ids.has(rel.targetRequirementId)) {
          errors.push({
            requirementId: req.id,
            requirementCode: req.code,
            missingTargetId: rel.targetRequirementId,
            relationType: rel.type,
          });
        }
      }
    }

    return errors;
  }

  /**
   * Generates document sections as a clean projection of approved requirements
   * according to GOST 34.602 structure.
   */
  public toProjectionSections(options: { onlyApproved?: boolean } = {}): Gost34Section[] {
    const { onlyApproved = true } = options;
    const reqsToProject = onlyApproved ? this.getApproved() : this.getAll();

    // Group requirements by target GOST 34 section
    const sectionGroups = new Map<string, { title: string; reqs: Gost34RequirementV2[] }>();

    for (const req of reqsToProject) {
      const gostSection = resolveGostSection({
        code: req.code,
        title: req.title,
        category: req.category,
        description: getRequirementEffectiveText(req),
      });

      if (!sectionGroups.has(gostSection.code)) {
        sectionGroups.set(gostSection.code, { title: gostSection.title, reqs: [] });
      }
      sectionGroups.get(gostSection.code)!.reqs.push(req);
    }

    const sections: Gost34Section[] = [];
    // Sort sections by code (4.1.1, 4.1.2, 4.1.3, ...)
    const sortedCodes = Array.from(sectionGroups.keys()).sort();

    for (const code of sortedCodes) {
      const group = sectionGroups.get(code)!;
      const paragraphs: string[] = [];

      for (const req of group.reqs) {
        const text = getRequirementEffectiveText(req);
        paragraphs.push(`${req.code} (${req.title}): ${text}`);
      }

      sections.push({
        id: `section-${code.replace(/\./g, '-')}`,
        numStr: code,
        title: group.title,
        paragraphs,
      });
    }

    return sections;
  }

  /**
   * Serializes the repository to JSON.
   */
  public toJSON(): string {
    return JSON.stringify(this.getAll(), null, 2);
  }

  /**
   * Deserializes a repository from JSON.
   */
  public static fromJSON(jsonStr: string): RequirementsRepository {
    try {
      const items = JSON.parse(jsonStr);
      return new RequirementsRepository(Array.isArray(items) ? items : []);
    } catch {
      return new RequirementsRepository([]);
    }
  }
}
