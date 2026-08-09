/**
 * Roles allowed to drive the GOST 34 constructor's server-side machinery
 * (LLM calls, file uploads, ad-hoc document generation).
 *
 * Reading and exporting an existing calculation stays public, matching the
 * PDF / XLSX / JSON routes — only the endpoints that spend server resources or
 * reach out to a network service require a session.
 */
export const GOST34_LLM_ROLES = ["architect", "admin"];
