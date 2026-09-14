import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHelpers';
import { loadCapacityWarnings } from '@/lib/capacityData';

export const dynamic = 'force-dynamic';

/** Недели, где этот расчёт делает роль перегруженной (E2). */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(['architect', 'admin']);
  if (auth instanceof NextResponse) return auth;
  try {
    const params = await props.params;
    return NextResponse.json({ warnings: await loadCapacityWarnings(params.id) });
  } catch (err) {
    return handleApiError(err, 'Failed to compute capacity warnings');
  }
}
