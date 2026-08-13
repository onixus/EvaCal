/**
 * Roles allowed to drive the GOST 34 constructor's server-side machinery
 * (LLM calls, file uploads, ad-hoc document generation).
 *
 * Export of an existing calculation requires staff session or a signed share
 * token (see lib/access.ts) — the public anonymous export path was removed.
 */
export const GOST34_LLM_ROLES = ['architect', 'admin'];
