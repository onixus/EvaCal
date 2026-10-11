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
  sectionOverrides?: Record<
    string,
    { title?: string; paragraphs?: string[]; appendParagraphs?: string[] }
  >;
  tzAuthor?: TzAuthorState;
  includeProposed?: boolean;
}): Record<string, { title?: string; paragraphs?: string[]; appendParagraphs?: string[] }> {
  const manual = { ...(params.sectionOverrides || {}) };
  if (params.docType !== 'TZ') return manual; // PZ/AF/PMI/SPEC/ACT/PSI не получают LLM-прозу
  const accepted = projectAcceptedOverlays(params.tzAuthor, params.includeProposed);
  // Приоритет на одном nodeId: принятая проза автора ТЗ заменяет ручную
  // правку раздела целиком (как и раньше), но дополнения из наборов решений
  // (appendParagraphs, #103 WP-7b) сохраняются и печатаются после неё.
  // title-ключи manual не затирают id.
  const out = { ...manual };
  for (const [nodeId, overlay] of Object.entries(accepted)) {
    const append = manual[nodeId]?.appendParagraphs;
    out[nodeId] = {
      paragraphs: overlay.paragraphs,
      ...(append ? { appendParagraphs: append } : {}),
    };
  }
  return out;
}
