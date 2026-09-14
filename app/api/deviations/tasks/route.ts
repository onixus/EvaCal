import { NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHelpers';
import { loadDeviationCatalog } from '@/lib/deviationsData';

export const dynamic = 'force-dynamic';

/** Каталог задач и значения фильтров для конструктора (E3). */
export async function GET() {
  const auth = await requireApiRole(['presale', 'architect', 'reviewer', 'admin']);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json(await loadDeviationCatalog());
  } catch (err) {
    return handleApiError(err, 'Failed to load task catalog');
  }
}
