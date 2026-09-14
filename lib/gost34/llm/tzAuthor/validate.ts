import { Gost34InputPayload } from '../../types';
import { ProjectContext } from '../../context/types';
import { TZ_SCHEMA_2020 } from '../../schema/tz34-2020';
import { collectGroundingPack } from './grounding';
import { detectDraftFlags, isHardFlag } from './flags';
import { TzAuthorDiagnostic, TzAuthorState, TzSectionProposal } from './types';

export class TzAuthorHardFlagsError extends Error {
  readonly code = 'tz_author_hard_flags' as const;
  readonly statusCode = 409;
  readonly nodes: TzAuthorDiagnostic[];

  constructor(nodes: TzAuthorDiagnostic[]) {
    super(`Hard flags detected in accepted TZ proposals: ${nodes.map((n) => n.nodeId).join(', ')}`);
    this.name = 'TzAuthorHardFlagsError';
    this.nodes = nodes;
  }
}

export interface ValidateTzAuthorParams {
  payload: Gost34InputPayload;
  context?: ProjectContext;
  tzAuthor?: TzAuthorState;
  checkProposed?: boolean;
}

export interface ValidateTzAuthorResult {
  validTzAuthor: TzAuthorState;
  diagnostics: TzAuthorDiagnostic[];
  hasHardFlags: boolean;
}

/**
 * Валидирует предложения tzAuthor против актуального GroundingPack схемы.
 * Клиентским флагам не доверяем — сервер повторно гоняет detectDraftFlags.
 *
 * Если найдены hard-флаги:
 * - В diagnostics добавляется запись { nodeId, flagCodes }.
 * - Предложение исключается из validTzAuthor (для предпросмотра восстанавливается baseline).
 * - hasHardFlags выставляется в true.
 */
export function validateTzAuthorProposals(params: ValidateTzAuthorParams): ValidateTzAuthorResult {
  const diagnostics: TzAuthorDiagnostic[] = [];

  if (!params.tzAuthor || !params.tzAuthor.proposals) {
    return {
      validTzAuthor: params.tzAuthor || {
        promptVersion: 'tz-author-v1',
        speculateDefault: false,
        proposals: {},
      },
      diagnostics: [],
      hasHardFlags: false,
    };
  }

  const effectiveContext: ProjectContext =
    params.context ||
    params.payload.projectContext ||
    {};

  const validProposals: Record<string, TzSectionProposal> = {};

  for (const [nodeId, proposal] of Object.entries(params.tzAuthor.proposals)) {
    const isAccepted = proposal.status === 'ACCEPTED' || proposal.status === 'ACCEPTED_EDITED';
    const isProposed = Boolean(params.checkProposed) && proposal.status === 'PROPOSED';

    if (!isAccepted && !isProposed) {
      // Предложения в статусе REJECTED или непроверяемый PROPOSED оставляем в state без изменений
      validProposals[nodeId] = proposal;
      continue;
    }

    try {
      const pack = collectGroundingPack({
        nodeId: proposal.nodeId || nodeId,
        payload: params.payload,
        context: effectiveContext,
        schema: TZ_SCHEMA_2020,
        speculate: Boolean(proposal.speculate),
      });

      const flags = detectDraftFlags(pack, pack.baseline.paragraphs, proposal.paragraphs);
      const hardFlags = flags.filter(isHardFlag);

      if (hardFlags.length > 0) {
        diagnostics.push({
          nodeId: proposal.nodeId || nodeId,
          flagCodes: Array.from(new Set(hardFlags.map((f) => f.code))),
        });
        // Hard-флаг: не включаем в validProposals, чтобы узел откатился к baseline
        continue;
      }
    } catch (err) {
      console.warn(`Failed to collect grounding pack for node ${nodeId}:`, err);
      diagnostics.push({
        nodeId: proposal.nodeId || nodeId,
        flagCodes: ['LLM_UNVERIFIABLE'],
      });
      continue;
    }

    validProposals[nodeId] = proposal;
  }

  return {
    validTzAuthor: {
      ...params.tzAuthor,
      proposals: validProposals,
    },
    diagnostics,
    hasHardFlags: diagnostics.length > 0,
  };
}
