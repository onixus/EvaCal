import { Gost34InputPayload, RequirementCategory } from '../../types';
import { ProjectContext, ContextGap, ContextProvenance, CONTEXT_GAP_PLACEHOLDER } from '../../context/types';
import { RequirementStatus, RequirementType, Gost34RequirementV2 } from '../../requirements/v2';
import { fromGost34RequirementItems } from '../../requirements/adapters';
import { CitationKey } from '../../standards/types';
import { ApplicabilityStatus } from '../../applicability/types';
import { TZ_SCHEMA_2020 } from '../../schema/tz34-2020';
import { walkDraftableNodes } from './schemaWalk';
import { DocumentSchema, SectionContent } from '../../schema/types';

export interface GroundingRequirement {
  id: string;
  code: string;
  status: RequirementStatus;
  category: RequirementCategory;
  type: RequirementType;
  originalText: string;
  normalizedText?: string;
}

export interface GroundingPack {
  node: {
    id: string;
    title: string;
    required: boolean;
    numStr: string;
    hasChildren: boolean;
    leadInOnly: boolean;
  };
  baseline: {
    paragraphs: string[];
    tableCaptions: string[];
    gapPaths: string[];
    gaps: ContextGap[];
  };
  requirements: GroundingRequirement[];
  contextSlice: Record<string, unknown>;
  provenance: ContextProvenance[];
  applicability: Array<{
    standardId: string;
    title: string;
    finalStatus: ApplicabilityStatus;
  }>;
  calculationFacts: {
    stages?: Array<{ name: string; role: string; hours: number }>;
    totalLaborHours?: number;
    risks?: Array<{ description: string; hours: number }>;
  } | null;
  allowedCitationIds: string[];
  allowedCitationTexts: string[];
  speculate: boolean;
}

export const NODE_CITE_KEYS: Record<string, CitationKey[]> = {
  'tz2020-development-order': ['lifecycle'],
  'tz2020-acceptance': ['testing'],
  'tz2020-documentation': ['documentsClassifier'],
  'tz2020-sources': [
    'primary',
    'documentsClassifier',
    'projectDocumentation',
    'lifecycle',
    'testing',
  ],
};

export function collectAllowedCitations(
  nodeId: string,
  payload: Gost34InputPayload,
  applicability: Array<{ standardId: string; title: string; finalStatus: ApplicabilityStatus }>,
): {
  allowedCitationIds: string[];
  allowedCitationTexts: string[];
} {
  const ids = new Set<string>();
  const texts = new Set<string>();
  const p = payload.standardProfile;

  // Первичный стандарт профиля — на КАЖДОМ узле ТЗ.
  if (p?.primaryStandard) {
    ids.add(p.primaryStandard.id); // gost-34.602-2020
    texts.add(p.primaryStandard.title);
  }
  if (p?.citations?.primary) {
    texts.add(p.citations.primary); // «ГОСТ 34.602-2020»
  }

  for (const key of NODE_CITE_KEYS[nodeId] ?? []) {
    if (p?.citations?.[key]) {
      texts.add(p.citations[key]);
    }
    ids.add(key);
  }

  if (nodeId === 'tz2020-sources') {
    for (const ref of [
      ...(p?.documentStandards || []),
      ...(p?.lifecycleStandards || []),
      ...(p?.testingStandards || []),
    ]) {
      ids.add(ref.id);
      texts.add(ref.title);
    }
  }

  for (const a of applicability) {
    if (a.finalStatus === 'APPLICABLE') {
      ids.add(a.standardId); // fstek_21 и т.д.
      texts.add(a.title);
    }
  }

  return { allowedCitationIds: [...ids], allowedCitationTexts: [...texts] };
}

export function hasPopulatedContext(slice: Record<string, unknown>): boolean {
  return Object.values(slice).some((v) => {
    if (v == null || v === '') return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'object') return hasPopulatedContext(v as Record<string, unknown>);
    return true;
  });
}

export function hasNonGapFacts(pack: GroundingPack): boolean {
  return (
    pack.requirements.length > 0 ||
    pack.calculationFacts !== null ||
    hasPopulatedContext(pack.contextSlice)
  );
}

export function shouldSkipLlm(pack: GroundingPack): boolean {
  return pack.speculate === false && !hasNonGapFacts(pack);
}

function getContextSlice(nodeId: string, payload: Gost34InputPayload, ctx: ProjectContext): Record<string, unknown> {
  switch (nodeId) {
    case 'tz2020-general':
      return {
        metadata: payload.metadata,
        lifecycle: ctx.lifecycle,
      };
    case 'tz2020-goals-goals':
      return {
        goals: ctx.goals,
        measurableGoalCriteria: ctx.measurableGoalCriteria,
      };
    case 'tz2020-goals-purpose':
      return {
        systemPurpose: ctx.systemPurpose,
        automationObject: ctx.automationObject,
        users: ctx.users,
      };
    case 'tz2020-object':
      return {
        automationObject: ctx.automationObject,
        dataClasses: ctx.dataClasses,
        architecture: ctx.architecture,
        users: ctx.users,
      };
    case 'tz2020-req-structure':
      return {
        architecture: ctx.architecture,
        deploymentModel: ctx.deploymentModel,
        roles: ctx.roles,
        integrations: ctx.integrations,
      };
    case 'tz2020-req-support':
      return {
        dataClasses: ctx.dataClasses,
        infrastructure: ctx.infrastructure,
        roles: ctx.roles,
      };
    case 'tz2020-req-common-tech':
      return {
        availability: ctx.availability,
        performance: ctx.performance,
        security: ctx.security,
      };
    case 'tz2020-work-scope':
      return {
        lifecycle: ctx.lifecycle,
      };
    case 'tz2020-development-order':
      return {
        lifecycle: ctx.lifecycle,
      };
    case 'tz2020-preparation':
      return {
        infrastructure: ctx.infrastructure,
        users: ctx.users,
        roles: ctx.roles,
      };
    case 'tz2020-documentation':
      return {
        documentationRequirements: ctx.documentationRequirements,
      };
    case 'tz2020-sources':
      return {
        vendorFiles: payload.vendorSourceFiles || [],
      };
    case 'tz2020-appendix-gaps':
      return {
        gaps: ctx.gaps || [],
      };
    default:
      return {};
  }
}

export function collectGroundingPack(params: {
  nodeId: string;
  payload: Gost34InputPayload;
  context: ProjectContext;
  schema?: DocumentSchema;
  speculate?: boolean;
}): GroundingPack {
  const { nodeId, payload, context, schema = TZ_SCHEMA_2020, speculate = false } = params;

  const buildCtx = { payload, context, schema };
  const draftableNodes = walkDraftableNodes(schema, buildCtx);
  const nodeInfo = draftableNodes.find((n) => n.id === nodeId);
  if (!nodeInfo) {
    throw new Error(`Node ${nodeId} is not a draftable node in schema ${schema.id}`);
  }

  // 1. Baseline
  let baselineParagraphs: string[] = [];
  let tableCaptions: string[] = [];
  let gapPaths: string[] = [];
  let gaps: ContextGap[] = [];

  if (nodeInfo.node.build) {
    const content: SectionContent = nodeInfo.node.build(buildCtx);
    baselineParagraphs = [...(content.paragraphs || [])];
    (content.items || []).forEach((item, idx) => {
      baselineParagraphs.push(`${nodeInfo.numStr}.${idx + 1} ${item}`);
    });
    if (content.gaps && content.gaps.length > 0) {
      gaps = content.gaps;
      gapPaths = content.gaps.map((g) => g.path);
      for (const g of content.gaps) {
        baselineParagraphs.push(
          `${g.label} — ${CONTEXT_GAP_PLACEHOLDER}${g.hint ? ` (источник данных: ${g.hint})` : ''}.`,
        );
      }
    }
    tableCaptions = (content.tables || []).map((t) => t.caption || '').filter(Boolean);
  }

  // 2. Applicability
  const applicabilityList = (payload.applicability || []).map((a) => ({
    standardId: a.standardId,
    title: a.title,
    finalStatus: a.finalStatus,
  }));

  // 3. Citations
  const { allowedCitationIds, allowedCitationTexts } = collectAllowedCitations(
    nodeId,
    payload,
    applicabilityList,
  );

  // 4. Requirements
  const rawReqs: Gost34RequirementV2[] =
    payload.requirementsV2 || fromGost34RequirementItems(payload.customRequirements || []);

  const allReqs: GroundingRequirement[] = rawReqs.map((r) => ({
    id: r.id,
    code: r.code,
    status: r.approval?.status || 'PROPOSED',
    category: r.category,
    type: r.type,
    originalText: r.originalText || (r as any).description || '',
    normalizedText: r.normalizedText,
  }));

  let filteredReqs: GroundingRequirement[] = [];

  if (nodeId === 'tz2020-req-functions') {
    // 1. approval.status === 'APPROVED' first
    // 2. category === 'functional'
    // 3. type === 'system'
    // 4. code lexicographical
    filteredReqs = [...allReqs]
      .sort((a, b) => {
        const aApp = a.status === 'APPROVED' ? 1 : 0;
        const bApp = b.status === 'APPROVED' ? 1 : 0;
        if (aApp !== bApp) return bApp - aApp;

        const aFunc = a.category === 'functional' ? 1 : 0;
        const bFunc = b.category === 'functional' ? 1 : 0;
        if (aFunc !== bFunc) return bFunc - aFunc;

        const aSys = a.type === 'system' ? 1 : 0;
        const bSys = b.type === 'system' ? 1 : 0;
        if (aSys !== bSys) return bSys - aSys;

        return a.code.localeCompare(b.code, 'ru');
      })
      .slice(0, 40);
  } else if (nodeId === 'tz2020-req-structure') {
    filteredReqs = allReqs.filter((r) => ['technical', 'integration'].includes(r.category));
  } else if (nodeId === 'tz2020-req-support') {
    filteredReqs = allReqs.filter((r) =>
      ['technical', 'hardware_pac', 'software', 'software_supply', 'infra_setup'].includes(r.category),
    );
  } else if (nodeId === 'tz2020-req-common-tech') {
    filteredReqs = allReqs.filter((r) =>
      ['security', 'reliability', 'performance'].includes(r.category),
    );
  } else if (nodeId === 'tz2020-work-scope') {
    const linkedCodes = new Set<string>();
    if (payload.traceability?.links) {
      for (const link of payload.traceability.links) {
        if (link.sourceId) {
          linkedCodes.add(link.sourceId);
        }
      }
    }
    filteredReqs = allReqs.filter((r) => linkedCodes.has(r.id) || linkedCodes.has(r.code));
  } else if (nodeId === 'tz2020-acceptance') {
    filteredReqs = allReqs.filter(
      (r) => r.originalText.trim().length > 0 || (r.normalizedText && r.normalizedText.trim().length > 0),
    );
  } else if (nodeId === 'tz2020-preparation') {
    filteredReqs = allReqs.filter((r) => r.category === 'organizational');
  } else {
    filteredReqs = [];
  }

  // 5. Calculation facts
  let calculationFacts: GroundingPack['calculationFacts'] = null;
  if (nodeId === 'tz2020-work-scope') {
    calculationFacts = {
      stages: (payload.stages || []).map((s) => ({
        name: s.name,
        role: s.role,
        hours: s.hours,
      })),
      totalLaborHours: payload.totalLaborHours,
      risks: (payload.risks || []).map((r) => ({
        description: r.description,
        hours: r.hours,
      })),
    };
  } else if (nodeId === 'tz2020-development-order') {
    calculationFacts = {
      totalLaborHours: payload.totalLaborHours,
    };
  }

  // 6. Context slice
  const contextSlice = getContextSlice(nodeId, payload, context);

  // 7. Provenance
  const sliceKeys = new Set(Object.keys(contextSlice));
  const provenance = (context.provenance || []).filter((p) => {
    const rootKey = p.path.split('.')[0];
    return sliceKeys.has(rootKey);
  });

  return {
    node: {
      id: nodeInfo.id,
      title: nodeInfo.title,
      required: nodeInfo.required,
      numStr: nodeInfo.numStr,
      hasChildren: nodeInfo.hasChildren,
      leadInOnly: nodeInfo.leadInOnly,
    },
    baseline: {
      paragraphs: baselineParagraphs,
      tableCaptions,
      gapPaths,
      gaps,
    },
    requirements: filteredReqs,
    contextSlice,
    provenance,
    applicability: applicabilityList,
    calculationFacts,
    allowedCitationIds,
    allowedCitationTexts,
    speculate,
  };
}
