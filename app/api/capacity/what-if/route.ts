import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHelpers';
import { loadCapacityMatrix, MAX_WEEKS } from '@/lib/capacityData';
import type { CalcShift } from '@/lib/capacity';

export const dynamic = 'force-dynamic';

/** Та же матрица со временными сдвигами расчётов; в базу ничего не пишется. */
export async function POST(req: NextRequest) {
  const auth = await requireApiRole(['architect', 'admin']);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json().catch(() => ({}));
    const shifts: CalcShift[] = Array.isArray(body.shifts)
      ? body.shifts
          .map((s: { calculationId?: unknown; shiftDays?: unknown }) => ({
            calculationId: String(s.calculationId ?? ''),
            shiftDays: Math.round(Number(s.shiftDays) || 0),
          }))
          .filter((s: CalcShift) => s.calculationId && Math.abs(s.shiftDays) <= 365)
      : [];
    const from = body.from ? new Date(body.from) : undefined;
    const weeks = Number(body.weeks);
    return NextResponse.json(
      await loadCapacityMatrix({
        from: from && !Number.isNaN(from.getTime()) ? from : undefined,
        weeks: Number.isFinite(weeks) && weeks > 0 ? Math.min(MAX_WEEKS, weeks) : undefined,
        includeDrafts: Boolean(body.drafts),
        roles: Array.isArray(body.roles) ? body.roles.map(String) : undefined,
        shifts,
      }),
    );
  } catch (err) {
    return handleApiError(err, 'Failed to build what-if matrix');
  }
}
