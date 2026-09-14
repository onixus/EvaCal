import { GostDocumentType } from '../../types';
import { TzAuthorState } from './types';

export { validateTzAuthorProposals, TzAuthorHardFlagsError } from './validate';
export type { ValidateTzAuthorParams, ValidateTzAuthorResult } from './validate';

export function projectAcceptedOverlays(
  state: TzAuthorState | undefined,
  includeProposed: boolean = false,
): Record<string, { paragraphs: string[] }> {
  const out: Record<string, { paragraphs: string[] }> = {};
  if (!state) return out;
  for (const p of Object.values(state.proposals)) {
    const isAccepted = p.status === 'ACCEPTED' || p.status === 'ACCEPTED_EDITED';
    const isProposed = includeProposed && p.status === 'PROPOSED';
    if (!isAccepted && !isProposed) continue;
    out[p.nodeId] = { paragraphs: p.paragraphs }; // только nodeId, без title
  }
  return out;
}

export function overlaysForDocument(params: {
  docType: GostDocumentType;
  sectionOverrides?: Record<string, { title?: string; paragraphs?: string[] }>;
  tzAuthor?: TzAuthorState;
  includeProposed?: boolean;
}): Record<string, { title?: string; paragraphs?: string[] }> {
  const manual = { ...(params.sectionOverrides || {}) };
  if (params.docType !== 'TZ') return manual; // PZ/AF/PMI/SPEC/ACT/PSI не получают LLM-прозу
  const accepted = projectAcceptedOverlays(params.tzAuthor, params.includeProposed);
  // accepted побеждает manual на том же nodeId; title-ключи manual не затирают id
  return { ...manual, ...accepted };
}
