import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHelpers';
import { loadEarliestStart } from '@/lib/planningData';

export const dynamic = 'force-dynamic';

/**
 * Ближайшая дата старта (#103 WP-5e), при которой часы расчёта по ролям
 * помещаются в ёмкость с учётом резервов, календаря и спроса остальных проектов.
 * `?from=YYYY-MM-DD&days=182&drafts=1`. Ничего не пишет: перенос — через
 * `/api/capacity/apply` с возвращённым `shiftDays`.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiRole(['architect', 'gap', 'techwriter', 'reviewer', 'admin']);
  if (auth instanceof NextResponse) return auth;
  try {
    const sp = req.nextUrl.searchParams;
    const fromRaw = sp.get('from');
    const from = fromRaw ? new Date(fromRaw) : undefined;
    if (from && Number.isNaN(from.getTime())) {
      return NextResponse.json({ error: 'Некорректная дата from' }, { status: 400 });
    }
    const days = Number(sp.get('days'));
    const result = await loadEarliestStart(params.id, {
      from,
      horizonDays: Number.isFinite(days) && days > 0 ? days : undefined,
      includeDrafts: sp.get('drafts') === '1',
    });
    if (!result) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err, 'Failed to find earliest start');
  }
}
