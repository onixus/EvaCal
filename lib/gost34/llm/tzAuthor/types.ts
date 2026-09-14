export const TZ_AUTHOR_PROMPT_VERSION = 'tz-author-v1' as const;

export type TzDraftStatus =
  | 'PROPOSED' // свежий ответ модели или детерминированный skip; в экспорт не идёт
  | 'ACCEPTED' // принят без правки человеком
  | 'ACCEPTED_EDITED' // принят после правки, либо принят и затем изменён textarea
  | 'REJECTED'; // отклонён / сброшен; в экспорт не идёт

/** v1. LLM_ADDED_FACT и LLM_CHANGED_SCOPE зарезервированы до v1.1 и сюда не входят. */
export type LlmDraftFlagCode =
  | 'LLM_ADDED_NUMBER'
  | 'LLM_REMOVED_CONSTRAINT'
  | 'LLM_CHANGED_MODALITY'
  | 'LLM_INVENTED_NORM'
  /** Черновик нельзя проверить: узел неизвестен или grounding-пакет не собрался. */
  | 'LLM_UNVERIFIABLE';

export type LlmDraftFlagSeverity = 'block' | 'warn';

export interface LlmDraftFlag {
  code: LlmDraftFlagCode;
  severity: LlmDraftFlagSeverity;
  span: string;
  detail: string;
  baselineSpan?: string;
}

export interface TzGapQuestion {
  gapPath: string;
  question: string;
}

export interface TzSectionProposal {
  nodeId: string;
  schemaTitle: string;
  status: TzDraftStatus;
  /** Семантические абзацы БЕЗ префикса «4.4.1 ». Нумерацию пишет apply. */
  paragraphs: string[];
  questions: TzGapQuestion[];
  flags: LlmDraftFlag[];
  refusedGapPaths: string[];
  speculate: boolean;
  usedLlm: boolean;
  provenance: {
    providerId: string;
    model: string;
    promptVersion: typeof TZ_AUTHOR_PROMPT_VERSION | string;
    temperature: number;
    createdAt: string;
    createdBy: string;
    reviewedAt?: string;
    reviewedBy?: string;
    latencyMs?: number;
  };
}

export interface TzAuthorState {
  promptVersion: string;
  speculateDefault: false;
  proposals: Record<string, TzSectionProposal>; // key = nodeId
}

export interface TzAuthorDiagnostic {
  nodeId: string;
  flagCodes: LlmDraftFlagCode[];
}
