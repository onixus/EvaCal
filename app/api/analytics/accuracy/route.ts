import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHelpers';
import { parsePeriod } from '@/lib/leaderboard';
import { loadAccuracyAnalytics } from '@/lib/actualsData';

export const dynamic = 'force-dynamic';

/** Точность оценок по выигранным проектам с фактом. Только сотрудники. */
export async function GET(req: NextRequest) {
  const auth = await requireApiRole(['presale', 'architect', 'reviewer', 'admin']);
  if (auth instanceof NextResponse) return auth;
  try {
    const period = parsePeriod(req.nextUrl.searchParams.get('period'));
    const templateId = req.nextUrl.searchParams.get('templateId') || undefined;
    return NextResponse.json(await loadAccuracyAnalytics(period, templateId));
  } catch (err) {
    return handleApiError(err, 'Failed to build accuracy analytics');
  }
}
