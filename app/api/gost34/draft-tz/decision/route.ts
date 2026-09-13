import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { GOST34_LLM_ROLES } from '../../roles';
import { isTzAuthorEnabled } from '@/lib/gost34/llm/tzAuthor/flag';
import { loadCalculationForExport } from '@/lib/export';
import { analyzeAndNormalizeInput } from '@/lib/gost34/analyzer';
import { requireCalcAccess } from '@/lib/access';
import { clientIp, writeAudit, redactLlmMeta } from '@/lib/audit';
import { TZ_SCHEMA_2020 } from '@/lib/gost34/schema/tz34-2020';
import { walkDraftableNodes } from '@/lib/gost34/llm/tzAuthor/schemaWalk';
import { collectGroundingPack } from '@/lib/gost34/llm/tzAuthor/grounding';
import { detectDraftFlags, isHardFlag } from '@/lib/gost34/llm/tzAuthor/flags';
import { TzSectionProposal, TZ_AUTHOR_PROMPT_VERSION } from '@/lib/gost34/llm/tzAuthor/types';
import { stripClausePrefix } from '@/lib/gost34';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  // 1. Feature flag check
  if (!isTzAuthorEnabled()) {
    return NextResponse.json({ error: 'feature_disabled' }, { status: 403 });
  }

  // 2. Staff check
  const session = await requireApiRole(GOST34_LLM_ROLES);
  if (session instanceof NextResponse) return session;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const {
    calculationId,
    nodeId,
    decision,
    paragraphs = [],
    speculate = false,
    rawRequirements = [],
    applicabilityOverrides,
    manualLinks = [],
    projectContext,
    standardProfileId,
    provenance,
    usedLlm = true,
  } = body || {};

  if (!calculationId || !nodeId) {
    return NextResponse.json(
      { error: 'calculationId and nodeId are required' },
      { status: 400 },
    );
  }

  if (decision !== 'accept' && decision !== 'accept_edited' && decision !== 'reject') {
    return NextResponse.json(
      { error: 'decision must be one of: accept, accept_edited, reject' },
      { status: 400 },
    );
  }

  if (decision !== 'reject' && (!Array.isArray(paragraphs) || paragraphs.length === 0)) {
    return NextResponse.json(
      { error: 'paragraphs array is required for accept/accept_edited' },
      { status: 400 },
    );
  }

  const access = await requireCalcAccess(req, calculationId, ['write']);
  if (access instanceof NextResponse) return access;
  if (access.kind !== 'staff') {
    return NextResponse.json({ error: 'forbidden: staff only' }, { status: 403 });
  }

  const calculation = await loadCalculationForExport(calculationId);
  if (!calculation) {
    return NextResponse.json({ error: 'calculation not found' }, { status: 404 });
  }

  const normalizedPayload = analyzeAndNormalizeInput({
    calculation: calculation as any,
    rawRequirements,
    projectContext,
    metadataOverride: {
      docType: 'TZ',
      standardProfileId: standardProfileId || 'gost-34-2020',
      applicabilityOverrides,
    },
    manualTraceLinks: manualLinks,
  });

  const ctx = normalizedPayload.projectContext!;
  const draftableNodes = walkDraftableNodes(TZ_SCHEMA_2020, {
    payload: normalizedPayload,
    context: ctx,
    schema: TZ_SCHEMA_2020,
  });

  const node = draftableNodes.find((n) => n.id === nodeId);
  if (!node) {
    return NextResponse.json(
      { error: `Node ${nodeId} is unknown or not draftable` },
      { status: 400 },
    );
  }

  const actorUsername = session.username || session.userId || 'staff';
  const now = new Date().toISOString();

  // Branch 1: REJECT
  if (decision === 'reject') {
    const proposal: TzSectionProposal = {
      nodeId,
      schemaTitle: node.title,
      status: 'REJECTED',
      paragraphs: [],
      questions: [],
      flags: [],
      refusedGapPaths: [],
      speculate: Boolean(speculate),
      usedLlm: false,
      provenance: {
        providerId: provenance?.providerId || 'manual',
        model: provenance?.model || 'manual',
        promptVersion: provenance?.promptVersion || TZ_AUTHOR_PROMPT_VERSION,
        temperature: typeof provenance?.temperature === 'number' ? provenance.temperature : 0,
        createdAt: provenance?.createdAt || now,
        createdBy: provenance?.createdBy || actorUsername,
        reviewedAt: now,
        reviewedBy: actorUsername,
        latencyMs: provenance?.latencyMs || 0,
      },
    };

    try {
      await writeAudit({
        actorType: 'user',
        actorId: actorUsername,
        action: 'gost34.tz_author.reject',
        entityType: 'calculation',
        entityId: calculationId,
        meta: {
          nodeId,
          decision: 'reject',
          status: 'REJECTED',
        },
        ip: clientIp(req),
      });
    } catch (auditErr) {
      console.warn('Failed to write audit event for tz_author.reject:', auditErr);
    }

    return NextResponse.json({ proposal });
  }

  // Branch 2: ACCEPT / ACCEPT_EDITED
  const cleanParagraphs = paragraphs.map(stripClausePrefix);

  const pack = collectGroundingPack({
    nodeId,
    payload: normalizedPayload,
    context: ctx,
    schema: TZ_SCHEMA_2020,
    speculate: Boolean(speculate),
  });

  const flags = detectDraftFlags(pack, pack.baseline.paragraphs, cleanParagraphs);
  const hardFlags = flags.filter(isHardFlag);

  if (hardFlags.length > 0) {
    return NextResponse.json(
      {
        error: 'tz_author_hard_flags',
        nodes: [
          {
            nodeId,
            flagCodes: Array.from(new Set(hardFlags.map((f) => f.code))),
          },
        ],
      },
      { status: 409 },
    );
  }

  const proposal: TzSectionProposal = {
    nodeId,
    schemaTitle: node.title,
    status: decision === 'accept_edited' ? 'ACCEPTED_EDITED' : 'ACCEPTED',
    paragraphs: cleanParagraphs,
    questions: [],
    flags,
    refusedGapPaths: pack.baseline.gapPaths,
    speculate: Boolean(speculate),
    usedLlm: Boolean(usedLlm),
    provenance: {
      providerId: provenance?.providerId || 'manual',
      model: provenance?.model || 'manual',
      promptVersion: provenance?.promptVersion || TZ_AUTHOR_PROMPT_VERSION,
      temperature: typeof provenance?.temperature === 'number' ? provenance.temperature : 0,
      createdAt: provenance?.createdAt || now,
      createdBy: provenance?.createdBy || actorUsername,
      reviewedAt: now,
      reviewedBy: actorUsername,
      latencyMs: provenance?.latencyMs || 0,
    },
  };

  try {
    await writeAudit({
      actorType: 'user',
      actorId: actorUsername,
      action: decision === 'reject' ? 'gost34.tz_author.reject' : 'gost34.tz_author.accept',
      entityType: 'calculation',
      entityId: calculationId,
      meta: redactLlmMeta({
        nodeId,
        decision,
        status: proposal.status,
        flagCodes: flags.map((f) => f.code),
        usedLlm: proposal.usedLlm,
      }),
      ip: clientIp(req),
    });
  } catch (auditErr) {
    console.warn('Failed to write audit event for tz_author decision:', auditErr);
  }

  return NextResponse.json({ proposal });
}
