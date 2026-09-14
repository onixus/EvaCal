import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHelpers';
import { runDeviationReport } from '@/lib/deviationsData';

export const dynamic = 'force-dynamic';

/** Срез отклонений по конфигурации из тела (E3). Ничего не сохраняет. */
export async function POST(req: NextRequest) {
  const auth = await requireApiRole(['presale', 'architect', 'reviewer', 'admin']);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json().catch(() => ({}));
    return NextResponse.json(await runDeviationReport(body.config ?? body));
  } catch (err) {
    return handleApiError(err, 'Failed to build deviation report');
  }
}
