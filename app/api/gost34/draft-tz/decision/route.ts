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

const MAX_PARAGRAPHS = 200;
const MAX_PARAGRAPH_CHARS = 8000;

function shortString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 && v.length <= 120 ? v : undefined;
}

function isIsoDate(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v));
}

export async function POST(req: NextRequest) {
  // 1. Сначала аутентификация — иначе аноним по коду ответа узнаёт состояние фичефлага
  const session = await requireApiRole(GOST34_LLM_ROLES);
  if (session instanceof NextResponse) return session;

  // 2. Feature flag check
  if (!isTzAuthorEnabled()) {
    return NextResponse.json({ error: 'feature_disabled' }, { status: 403 });
  }

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
    return NextResponse.json({ error: 'calculationId and nodeId are required' }, { status: 400 });
  }

  if (decision !== 'accept' && decision !== 'accept_edited' && decision !== 'reject') {
    return NextResponse.json(
      { error: 'decision must be one of: accept, accept_edited, reject' },
      { status: 400 },
    );
  }

  if (
    decision !== 'reject' &&
    (!Array.isArray(paragraphs) ||
      paragraphs.length === 0 ||
      paragraphs.some((p: unknown) => typeof p !== 'string'))
  ) {
    return NextResponse.json(
      { error: 'paragraphs must be a non-empty array of strings for accept/accept_edited' },
      { status: 400 },
    );
  }
  if (
    paragraphs.length > MAX_PARAGRAPHS ||
    paragraphs.some((p: string) => p.length > MAX_PARAGRAPH_CHARS)
  ) {
    return NextResponse.json(
      {
        error: `paragraphs: не более ${MAX_PARAGRAPHS} абзацев по ${MAX_PARAGRAPH_CHARS} символов`,
      },
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

  // Нормализация и обход схемы работают с сырым телом запроса — ошибка формы
  // (кривые rawRequirements, projectContext) должна быть 400, а не 500.
  let normalizedPayload: ReturnType<typeof analyzeAndNormalizeInput>;
  let draftableNodes: ReturnType<typeof walkDraftableNodes>;
  try {
    normalizedPayload = analyzeAndNormalizeInput({
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
    draftableNodes = walkDraftableNodes(TZ_SCHEMA_2020, {
      payload: normalizedPayload,
      context: normalizedPayload.projectContext!,
      schema: TZ_SCHEMA_2020,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: 'invalid_input', message: err?.message || 'Не удалось разобрать входные данные' },
      { status: 400 },
    );
  }
  const ctx = normalizedPayload.projectContext!;

  const node = draftableNodes.find((n) => n.id === nodeId);
  if (!node) {
    return NextResponse.json(
      { error: `Node ${nodeId} is unknown or not draftable` },
      { status: 400 },
    );
  }

  const actorUsername = session.username || session.userId || 'staff';
  const now = new Date().toISOString();

  // Provenance от клиента — только идентификаторы модели/провайдера. Кто автор
  // и была ли LLM, сервер решает сам: усечение provenance до «manual» не должно
  // выдавать черновик модели за ручной текст.
  const claimedProviderId = shortString(provenance?.providerId) || 'manual';
  const claimedModel = shortString(provenance?.model) || 'manual';
  const llmInvolved = claimedProviderId !== 'manual' || claimedModel !== 'manual';
  const baseProvenance = {
    providerId: claimedProviderId,
    model: claimedModel,
    promptVersion: shortString(provenance?.promptVersion) || TZ_AUTHOR_PROMPT_VERSION,
    temperature: typeof provenance?.temperature === 'number' ? provenance.temperature : 0,
    createdAt: isIsoDate(provenance?.createdAt) ? provenance.createdAt : now,
    createdBy: actorUsername,
    reviewedAt: now,
    reviewedBy: actorUsername,
    latencyMs:
      typeof provenance?.latencyMs === 'number' && provenance.latencyMs >= 0
        ? provenance.latencyMs
        : 0,
  };

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
      provenance: baseProvenance,
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
    // Клиент не может объявить черновик модели ручным: если провайдер назван — LLM была
    usedLlm: llmInvolved || Boolean(usedLlm),
    provenance: baseProvenance,
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
