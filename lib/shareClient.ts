/** Browser helpers for calculation share tokens (Horizon A). */

const PREFIX = 'evacal_share:';

export function storeShareToken(calculationId: string, token: string): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(PREFIX + calculationId, token);
  } catch {
    // private mode / quota — ignore
  }
}

export function getShareToken(calculationId: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return sessionStorage.getItem(PREFIX + calculationId);
  } catch {
    return null;
  }
}

/** Merge share header into fetch headers when a token is known. */
export function withShareHeaders(
  calculationId: string | null | undefined,
  init?: HeadersInit,
): Headers {
  const headers = new Headers(init);
  if (calculationId) {
    const token = getShareToken(calculationId);
    if (token) headers.set('X-Share-Token', token);
  }
  // URL ?share= also accepted by the server; surface it for navigation links.
  if (typeof window !== 'undefined') {
    const q = new URLSearchParams(window.location.search).get('share');
    if (q && !headers.has('X-Share-Token')) headers.set('X-Share-Token', q);
  }
  return headers;
}

export function shareQuerySuffix(calculationId: string): string {
  const token = getShareToken(calculationId);
  if (!token && typeof window !== 'undefined') {
    const q = new URLSearchParams(window.location.search).get('share');
    if (q) return `?share=${encodeURIComponent(q)}`;
    return '';
  }
  return token ? `?share=${encodeURIComponent(token)}` : '';
}
