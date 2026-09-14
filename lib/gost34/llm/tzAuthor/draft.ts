import { Gost34InputPayload } from '../../types';
import { ProjectContext, ContextGap, CONTEXT_GAP_PLACEHOLDER } from '../../context/types';
import { LlmProvider } from '../providers';
import { chatCompletion, extractJsonValue } from '../client';
import { collectGroundingPack, shouldSkipLlm } from './grounding';
import { detectDraftFlags } from './flags';
import { TzSectionProposal, TZ_AUTHOR_PROMPT_VERSION } from './types';
import { TZ_SCHEMA_2020 } from '../../schema/tz34-2020';
import { buildTzAuthorPromptMessages } from './prompts/tz-author-v1';
import { stripClausePrefix } from '../../index';

export interface DraftTzSectionInput {
  nodeId: string;
  payload: Gost34InputPayload;
  context: ProjectContext;
  provider: LlmProvider;
  model: string;
  speculate?: boolean;
  temperature?: number;
  createdBy?: string;
}

export interface DraftTzSectionResult {
  proposal: TzSectionProposal;
  baseline: {
    paragraphs: string[];
    gaps: ContextGap[];
  };
}

export async function draftTzSection(input: DraftTzSectionInput): Promise<DraftTzSectionResult> {
  const {
    nodeId,
    payload,
    context,
    provider,
    model,
    speculate = false,
    temperature = 0.2,
    createdBy = 'staff',
  } = input;
  const createdAt = new Date().toISOString();

  const pack = collectGroundingPack({
    nodeId,
    payload,
    context,
    schema: TZ_SCHEMA_2020,
    speculate,
  });

  if (shouldSkipLlm(pack)) {
    const proposal: TzSectionProposal = {
      nodeId: pack.node.id,
      schemaTitle: pack.node.title,
      status: 'PROPOSED',
      paragraphs: pack.baseline.paragraphs.map(stripClausePrefix),
      questions: pack.baseline.gaps.map((g) => ({
        gapPath: g.path,
        question: g.hint ? `Уточните: ${g.label}. ${g.hint}` : `Уточните: ${g.label}.`,
      })),
      flags: [],
      refusedGapPaths: pack.baseline.gapPaths,
      speculate: pack.speculate,
      usedLlm: false,
      provenance: {
        providerId: provider.id,
        model,
        promptVersion: TZ_AUTHOR_PROMPT_VERSION,
        temperature,
        createdAt,
        createdBy,
        latencyMs: 0,
      },
    };

    return {
      proposal,
      baseline: {
        paragraphs: pack.baseline.paragraphs,
        gaps: pack.baseline.gaps,
      },
    };
  }

  const messages = buildTzAuthorPromptMessages(pack);

  const start = Date.now();
  let chatRes;
  try {
    chatRes = await chatCompletion({
      provider,
      model,
      messages,
      temperature,
      responseFormat: 'json',
    });
  } catch (err: any) {
    if (
      err?.name === 'AbortError' ||
      err?.message?.toLowerCase().includes('timeout') ||
      err?.message?.toLowerCase().includes('aborted')
    ) {
      const timeoutErr = new Error('LLM request timed out');
      (timeoutErr as any).statusCode = 504;
      (timeoutErr as any).code = 'timeout';
      throw timeoutErr;
    }
    const providerErr = new Error(`LLM provider error: ${err?.message || 'unknown'}`);
    (providerErr as any).statusCode = 502;
    (providerErr as any).code = 'provider';
    throw providerErr;
  }

  let parsed: any;
  try {
    parsed = extractJsonValue(chatRes.text);
  } catch (err: any) {
    const parseErr = new Error(`Failed to parse LLM response as JSON: ${err?.message}`);
    (parseErr as any).statusCode = 502;
    (parseErr as any).code = 'parse';
    throw parseErr;
  }

  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.paragraphs)) {
    const parseErr = new Error('Invalid LLM response format: paragraphs array expected');
    (parseErr as any).statusCode = 502;
    (parseErr as any).code = 'parse';
    throw parseErr;
  }

  const rawParagraphs: string[] = parsed.paragraphs.filter(
    (p: unknown): p is string => typeof p === 'string',
  );
  const paragraphs = rawParagraphs.map(stripClausePrefix);
  // Из ответа модели берём только известные поля — лишнее в снимок мастера не попадает.
  const knownGaps = new Set(pack.baseline.gapPaths);
  const questions = Array.isArray(parsed.questions)
    ? parsed.questions
        .filter((q: any) => q && typeof q.gapPath === 'string' && typeof q.question === 'string')
        .map((q: any) => ({ gapPath: String(q.gapPath), question: String(q.question) }))
    : [];
  const refusedGapPaths = Array.isArray(parsed.refusedGapPaths)
    ? parsed.refusedGapPaths.filter(
        (p: unknown): p is string => typeof p === 'string' && knownGaps.has(p),
      )
    : [];

  const flags = detectDraftFlags(pack, pack.baseline.paragraphs, paragraphs);

  const proposal: TzSectionProposal = {
    nodeId: pack.node.id, // forced to request nodeId
    schemaTitle: pack.node.title,
    status: 'PROPOSED',
    paragraphs,
    questions,
    flags,
    refusedGapPaths,
    speculate: pack.speculate,
    usedLlm: true,
    provenance: {
      providerId: provider.id,
      model,
      promptVersion: TZ_AUTHOR_PROMPT_VERSION,
      temperature,
      createdAt,
      createdBy,
      latencyMs: Date.now() - start,
    },
  };

  return {
    proposal,
    baseline: {
      paragraphs: pack.baseline.paragraphs,
      gaps: pack.baseline.gaps,
    },
  };
}
