// Shared paging rules for the list screens and the list API endpoints.
// Lists here are unbounded by nature (the calculation archive only ever grows),
// so every list read goes through these helpers rather than fetching whole tables.

/** Rows per page on the list screens. */
export const PAGE_SIZE = 50;

/** Largest page size a caller may request via ?limit= on the list API endpoints. */
export const MAX_PAGE_SIZE = 200;

/** Clamps an untrusted ?page= value to a 1-based page number. */
export function parsePage(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/** Clamps an untrusted ?limit= value to 1..MAX_PAGE_SIZE. */
export function parseLimit(raw: string | null | undefined, fallback = PAGE_SIZE): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, MAX_PAGE_SIZE);
}

/** Prisma `skip`/`take` for a 1-based page number. */
export function pageArgs(page: number, pageSize = PAGE_SIZE): { skip: number; take: number } {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

export function totalPages(total: number, pageSize = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/**
 * Headers that let an API caller see it received one page rather than everything.
 * The response body stays a plain array, so existing callers keep working.
 */
export function paginationHeaders(
  total: number,
  page: number,
  pageSize: number,
): Record<string, string> {
  return {
    'X-Total-Count': String(total),
    'X-Page': String(page),
    'X-Page-Size': String(pageSize),
    'X-Total-Pages': String(totalPages(total, pageSize)),
  };
}
