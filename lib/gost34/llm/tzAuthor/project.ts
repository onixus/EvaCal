import { GostDocumentType } from '../../types';
import { TzAuthorState } from './types';

export function projectAcceptedOverlays(
  state: TzAuthorState | undefined,
): Record<string, { paragraphs: string[] }> {
  const out: Record<string, { paragraphs: string[] }> = {};
  if (!state) return out;
  for (const p of Object.values(state.proposals)) {
    if (p.status !== 'ACCEPTED' && p.status !== 'ACCEPTED_EDITED') continue;
    out[p.nodeId] = { paragraphs: p.paragraphs }; // только nodeId, без title
  }
  return out;
}

export function overlaysForDocument(params: {
  docType: GostDocumentType;
  sectionOverrides?: Record<string, { title?: string; paragraphs?: string[] }>;
  tzAuthor?: TzAuthorState;
}): Record<string, { title?: string; paragraphs?: string[] }> {
  const manual = { ...(params.sectionOverrides || {}) };
  if (params.docType !== 'TZ') return manual; // PZ/AF/PMI/SPEC/ACT/PSI не получают LLM-прозу
  const accepted = projectAcceptedOverlays(params.tzAuthor);
  // accepted побеждает manual на том же nodeId; title-ключи manual не затирают id
  return { ...manual, ...accepted };
}
