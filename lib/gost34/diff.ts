import { safeJsonParse } from '@/lib/json';
import type { GostWizardSnapshot } from '@/lib/project';

export interface RequirementItemDiff {
  id: string;
  originalText: string;
  normalizedText?: string;
  category?: string;
  source?: string;
  status?: string;
}

export interface RequirementModificationDiff {
  id: string;
  from: RequirementItemDiff;
  to: RequirementItemDiff;
  changes: string[];
}

export interface TraceLinkDiff {
  sourceId: string;
  targetStageId: string;
}

export interface SectionOverrideDiff {
  sectionKey: string;
  type: 'added' | 'removed' | 'modified';
  before?: { title?: string; paragraphs?: string[]; items?: string[] };
  after?: { title?: string; paragraphs?: string[]; items?: string[] };
}

export interface PackageDiffResult {
  fromPackage: {
    id: string;
    version: number;
    name: string;
    status: string;
    standardProfileId: string;
    standardProfileVersion: string;
    generatorVersion: string;
    createdAt: string;
  };
  toPackage: {
    id: string;
    version: number;
    name: string;
    status: string;
    standardProfileId: string;
    standardProfileVersion: string;
    generatorVersion: string;
    createdAt: string;
  };
  general: {
    profileChanged: boolean;
    profileFrom: string;
    profileTo: string;
    documentTypesAdded: string[];
    documentTypesRemoved: string[];
    layoutChanged: boolean;
    layoutFrom?: string;
    layoutTo?: string;
  };
  requirements: {
    totalFrom: number;
    totalTo: number;
    added: RequirementItemDiff[];
    removed: RequirementItemDiff[];
    modified: RequirementModificationDiff[];
    unchangedCount: number;
  };
  traceability: {
    addedLinks: TraceLinkDiff[];
    removedLinks: TraceLinkDiff[];
    coverageFrom: number;
    coverageTo: number;
  };
  applicability: {
    changedStandards: Array<{
      standardId: string;
      from?: unknown;
      to?: unknown;
    }>;
  };
  sections: {
    overrides: SectionOverrideDiff[];
  };
  signatures: {
    changed: Array<{ role: string; from?: string; to?: string }>;
  };
}

export interface GostPackageLike {
  id: string;
  version: number;
  name: string;
  status: string;
  standardProfileId: string;
  standardProfileVersion: string;
  generatorVersion: string;
  documentTypes: string;
  snapshot?: string | null;
  createdAt: Date | string;
}

/**
 * Parses snapshot JSON safely from package record.
 */
export function parsePackageSnapshot(pkg: GostPackageLike): GostWizardSnapshot {
  if (!pkg.snapshot) return {};
  if (typeof pkg.snapshot === 'object') return pkg.snapshot as GostWizardSnapshot;
  return safeJsonParse<GostWizardSnapshot>(pkg.snapshot, {});
}

/**
 * Computes structural difference between two released/draft GOST 34 package snapshots.
 */
export function computePackageDiff(
  fromPkg: GostPackageLike,
  toPkg: GostPackageLike,
): PackageDiffResult {
  const fromSnap = parsePackageSnapshot(fromPkg);
  const toSnap = parsePackageSnapshot(toPkg);

  const docTypesFrom = safeJsonParse<string[]>(fromPkg.documentTypes, ['tz']);
  const docTypesTo = safeJsonParse<string[]>(toPkg.documentTypes, ['tz']);

  const docTypesAdded = docTypesTo.filter((dt) => !docTypesFrom.includes(dt));
  const docTypesRemoved = docTypesFrom.filter((dt) => !docTypesTo.includes(dt));

  const profileFrom = `${fromPkg.standardProfileId} (${fromPkg.standardProfileVersion})`;
  const profileTo = `${toPkg.standardProfileId} (${toPkg.standardProfileVersion})`;

  // Requirements comparison
  const reqsFromList = (Array.isArray(fromSnap.requirements) ? fromSnap.requirements : []) as Array<
    Record<string, any>
  >;
  const reqsToList = (Array.isArray(toSnap.requirements) ? toSnap.requirements : []) as Array<
    Record<string, any>
  >;

  const reqsFromMap = new Map<string, RequirementItemDiff>();
  for (const r of reqsFromList) {
    const id = String(r.id || r.key || '');
    if (id) {
      reqsFromMap.set(id, {
        id,
        originalText: r.originalText || r.text || r.title || '',
        normalizedText: r.normalizedText,
        category: r.category,
        source: r.source,
        status: r.status,
      });
    }
  }

  const reqsToMap = new Map<string, RequirementItemDiff>();
  for (const r of reqsToList) {
    const id = String(r.id || r.key || '');
    if (id) {
      reqsToMap.set(id, {
        id,
        originalText: r.originalText || r.text || r.title || '',
        normalizedText: r.normalizedText,
        category: r.category,
        source: r.source,
        status: r.status,
      });
    }
  }

  const addedReqs: RequirementItemDiff[] = [];
  const removedReqs: RequirementItemDiff[] = [];
  const modifiedReqs: RequirementModificationDiff[] = [];
  let unchangedReqCount = 0;

  for (const [id, toReq] of reqsToMap.entries()) {
    if (!reqsFromMap.has(id)) {
      addedReqs.push(toReq);
    } else {
      const fromReq = reqsFromMap.get(id)!;
      const changes: string[] = [];
      if (fromReq.originalText !== toReq.originalText) changes.push('originalText');
      if (fromReq.normalizedText !== toReq.normalizedText) changes.push('normalizedText');
      if (fromReq.category !== toReq.category) changes.push('category');
      if (fromReq.status !== toReq.status) changes.push('status');
      if (fromReq.source !== toReq.source) changes.push('source');

      if (changes.length > 0) {
        modifiedReqs.push({
          id,
          from: fromReq,
          to: toReq,
          changes,
        });
      } else {
        unchangedReqCount++;
      }
    }
  }

  for (const [id, fromReq] of reqsFromMap.entries()) {
    if (!reqsToMap.has(id)) {
      removedReqs.push(fromReq);
    }
  }

  // Traceability links
  const linksFrom = (Array.isArray(fromSnap.manualLinks) ? fromSnap.manualLinks : []) as Array<{
    sourceId: string;
    targetStageId: string;
  }>;
  const linksTo = (Array.isArray(toSnap.manualLinks) ? toSnap.manualLinks : []) as Array<{
    sourceId: string;
    targetStageId: string;
  }>;

  const linksFromKeySet = new Set(linksFrom.map((l) => `${l.sourceId}->${l.targetStageId}`));
  const linksToKeySet = new Set(linksTo.map((l) => `${l.sourceId}->${l.targetStageId}`));

  const addedLinks = linksTo.filter(
    (l) => !linksFromKeySet.has(`${l.sourceId}->${l.targetStageId}`),
  );
  const removedLinks = linksFrom.filter(
    (l) => !linksToKeySet.has(`${l.sourceId}->${l.targetStageId}`),
  );

  const coverageFrom =
    reqsFromList.length > 0 ? Math.round((linksFrom.length / reqsFromList.length) * 100) : 0;
  const coverageTo =
    reqsToList.length > 0 ? Math.round((linksTo.length / reqsToList.length) * 100) : 0;

  // Applicability overrides
  const appFrom = fromSnap.applicabilityOverrides || {};
  const appTo = toSnap.applicabilityOverrides || {};
  const allAppKeys = new Set([...Object.keys(appFrom), ...Object.keys(appTo)]);
  const changedStandards: Array<{ standardId: string; from?: unknown; to?: unknown }> = [];

  for (const key of allAppKeys) {
    const valFrom = appFrom[key];
    const valTo = appTo[key];
    if (JSON.stringify(valFrom) !== JSON.stringify(valTo)) {
      changedStandards.push({
        standardId: key,
        from: valFrom,
        to: valTo,
      });
    }
  }

  // Section overrides
  const secFrom = fromSnap.sectionOverrides || {};
  const secTo = toSnap.sectionOverrides || {};
  const allSecKeys = new Set([...Object.keys(secFrom), ...Object.keys(secTo)]);
  const sectionOverridesDiff: SectionOverrideDiff[] = [];

  for (const key of allSecKeys) {
    const inFrom = key in secFrom;
    const inTo = key in secTo;
    if (!inFrom && inTo) {
      sectionOverridesDiff.push({
        sectionKey: key,
        type: 'added',
        after: secTo[key],
      });
    } else if (inFrom && !inTo) {
      sectionOverridesDiff.push({
        sectionKey: key,
        type: 'removed',
        before: secFrom[key],
      });
    } else if (JSON.stringify(secFrom[key]) !== JSON.stringify(secTo[key])) {
      sectionOverridesDiff.push({
        sectionKey: key,
        type: 'modified',
        before: secFrom[key],
        after: secTo[key],
      });
    }
  }

  // Signatures
  const sigFrom = fromSnap.signatures || {};
  const sigTo = toSnap.signatures || {};
  const allSigKeys = new Set([...Object.keys(sigFrom), ...Object.keys(sigTo)]);
  const changedSignatures: Array<{ role: string; from?: string; to?: string }> = [];

  for (const role of allSigKeys) {
    if (sigFrom[role] !== sigTo[role]) {
      changedSignatures.push({
        role,
        from: sigFrom[role],
        to: sigTo[role],
      });
    }
  }

  return {
    fromPackage: {
      id: fromPkg.id,
      version: fromPkg.version,
      name: fromPkg.name,
      status: fromPkg.status,
      standardProfileId: fromPkg.standardProfileId,
      standardProfileVersion: fromPkg.standardProfileVersion,
      generatorVersion: fromPkg.generatorVersion,
      createdAt:
        typeof fromPkg.createdAt === 'string' ? fromPkg.createdAt : fromPkg.createdAt.toISOString(),
    },
    toPackage: {
      id: toPkg.id,
      version: toPkg.version,
      name: toPkg.name,
      status: toPkg.status,
      standardProfileId: toPkg.standardProfileId,
      standardProfileVersion: toPkg.standardProfileVersion,
      generatorVersion: toPkg.generatorVersion,
      createdAt:
        typeof toPkg.createdAt === 'string' ? toPkg.createdAt : toPkg.createdAt.toISOString(),
    },
    general: {
      profileChanged: profileFrom !== profileTo,
      profileFrom,
      profileTo,
      documentTypesAdded: docTypesAdded,
      documentTypesRemoved: docTypesRemoved,
      layoutChanged: fromSnap.layoutProfileId !== toSnap.layoutProfileId,
      layoutFrom: fromSnap.layoutProfileId,
      layoutTo: toSnap.layoutProfileId,
    },
    requirements: {
      totalFrom: reqsFromList.length,
      totalTo: reqsToList.length,
      added: addedReqs,
      removed: removedReqs,
      modified: modifiedReqs,
      unchangedCount: unchangedReqCount,
    },
    traceability: {
      addedLinks,
      removedLinks,
      coverageFrom,
      coverageTo,
    },
    applicability: {
      changedStandards,
    },
    sections: {
      overrides: sectionOverridesDiff,
    },
    signatures: {
      changed: changedSignatures,
    },
  };
}
