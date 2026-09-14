import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHelpers';
import { parsePeriod } from '@/lib/leaderboard';
import { loadDealAnalytics } from '@/lib/actualsData';

export const dynamic = 'force-dynamic';

/** Сделки: win rate, причины проигрышей, скидка → исход. Только сотрудники. */
export async function GET(req: NextRequest) {
  const auth = await requireApiRole(['presale', 'architect', 'reviewer', 'admin']);
  if (auth instanceof NextResponse) return auth;
  try {
    const period = parsePeriod(req.nextUrl.searchParams.get('period'));
    return NextResponse.json(await loadDealAnalytics(period));
  } catch (err) {
    return handleApiError(err, 'Failed to build deal analytics');
  }
}
