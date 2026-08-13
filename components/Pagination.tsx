import Link from 'next/link';
import { totalPages } from '@/lib/pagination';

/**
 * Plain-link pager for the server-rendered list screens: no client JS, and the
 * current page stays in the URL so a page of the archive can be linked to directly.
 * Renders nothing when everything already fits on one page.
 */
export default function Pagination({
  page,
  pageSize,
  total,
  basePath,
  pageParam = 'page',
}: {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
  /** Query key to use, so one screen can page two independent lists. */
  pageParam?: string;
}) {
  const pages = totalPages(total, pageSize);
  if (pages <= 1) return null;

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  const href = (target: number) => `${basePath}?${pageParam}=${target}`;

  return (
    <div className="mt-4 flex items-center justify-between gap-4 text-sm">
      <span className="text-slate-500">
        Показаны {first}–{last} из {total}
      </span>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link href={href(page - 1)} className="btn-secondary" rel="prev">
            ← Назад
          </Link>
        ) : (
          <span className="btn-secondary pointer-events-none opacity-40" aria-disabled="true">
            ← Назад
          </span>
        )}
        <span className="text-slate-500">
          {page} / {pages}
        </span>
        {page < pages ? (
          <Link href={href(page + 1)} className="btn-secondary" rel="next">
            Вперёд →
          </Link>
        ) : (
          <span className="btn-secondary pointer-events-none opacity-40" aria-disabled="true">
            Вперёд →
          </span>
        )}
      </div>
    </div>
  );
}
