import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHelpers';
import { loadCapacityMatrix, parseCapacityQuery } from '@/lib/capacityData';

export const dynamic = 'force-dynamic';

/**
 * Матрица роль × неделя: спрос (твёрдый и взвешенный), ёмкость, загрузка.
 * `?from=&weeks=&drafts=1&roles=a,b`. Пресейл не видит: тут чужие проекты.
 */
export async function GET(req: NextRequest) {
  const auth = await requireApiRole(['architect', 'reviewer', 'admin']);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json(
      await loadCapacityMatrix(parseCapacityQuery(req.nextUrl.searchParams)),
    );
  } catch (err) {
    return handleApiError(err, 'Failed to build capacity matrix');
  }
}
