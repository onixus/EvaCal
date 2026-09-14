import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { GOST34_LLM_ROLES } from '../roles';
import { isTzAuthorEnabled } from '@/lib/gost34/llm/tzAuthor/flag';
import { resolveLlmProvider } from '@/lib/gost34/llm/providers';
import { draftTzSection } from '@/lib/gost34/llm/tzAuthor/draft';
import { loadCalculationForExport } from '@/lib/export';
import { analyzeAndNormalizeInput } from '@/lib/gost34/analyzer';
import { requireCalcAccess } from '@/lib/access';
import { clientIp, writeAudit, redactLlmMeta } from '@/lib/audit';
import { TZ_SCHEMA_2020 } from '@/lib/gost34/schema/tz34-2020';
import { walkDraftableNodes } from '@/lib/gost34/llm/tzAuthor/schemaWalk';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

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
    providerId,
    model,
    speculate = false,
    rawRequirements = [],
    applicabilityOverrides,
    manualLinks = [],
    projectContext,
    standardProfileId,
  } = body || {};

  if (!calculationId || !nodeId) {
    return NextResponse.json(
      { error: 'calculationId and nodeId are required' },
      { status: 400 },
    );
  }

  // Legacy profile forbidden for TZ Author (2020 schema only)
  if (standardProfileId === 'legacy' || standardProfileId === 'gost-34-legacy') {
    return NextResponse.json(
      { error: 'Legacy profile is not supported by TZ author. Use gost-34-2020.' },
      { status: 400 },
    );
  }

  const access = await requireCalcAccess(req, calculationId, ['read']);
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

  if (!draftableNodes.some((n) => n.id === nodeId)) {
    return NextResponse.json(
      { error: `Node ${nodeId} is unknown or not draftable` },
      { status: 400 },
    );
  }

  let provider;
  try {
    // Note: body.endpoint is completely ignored for SSRF perimeter security
    provider = resolveLlmProvider(providerId);
  } catch (err: any) {
    // Неизвестный providerId — ошибка запроса, а не upstream (см. providers.ts)
    return NextResponse.json(
      { error: 'provider', message: err?.message || 'Failed to resolve provider' },
      { status: 400 },
    );
  }

  const targetModel = model || provider.defaultModel;

  try {
    const actorUsername = session.username || session.userId || 'staff';
    const result = await draftTzSection({
      nodeId,
      payload: normalizedPayload,
      context: ctx,
      provider,
      model: targetModel,
      speculate: Boolean(speculate),
      createdBy: actorUsername,
    });

    // Write audit event without text
    try {
      await writeAudit({
        actorType: 'user',
        actorId: actorUsername,
        action: 'gost34.tz_author.draft',
        entityType: 'calculation',
        entityId: calculationId,
        meta: redactLlmMeta({
          nodeId: result.proposal.nodeId,
          providerId: result.proposal.provenance.providerId,
          model: result.proposal.provenance.model,
          promptVersion: result.proposal.provenance.promptVersion,
          flagCodes: result.proposal.flags.map((f) => f.code),
          latencyMs: result.proposal.provenance.latencyMs,
          speculate: result.proposal.speculate,
          status: result.proposal.status,
          usedLlm: result.proposal.usedLlm,
        }),
        ip: clientIp(req),
      });
    } catch (auditErr) {
      console.warn('Failed to write audit event for draft-tz:', auditErr);
    }

    return NextResponse.json(result);
  } catch (err: any) {
    const status = err.statusCode || 500;
    const errCode = err.code || 'internal';
    return NextResponse.json(
      { error: errCode, message: err.message },
      { status },
    );
  }
}
