import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHelpers';
import { loadCapacityMatrix, parseCapacityQuery } from '@/lib/capacityData';
import { renderCapacityXlsx } from '@/lib/xlsx';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireApiRole(['architect', 'gap', 'techwriter', 'reviewer', 'admin']);
  if (auth instanceof NextResponse) return auth;
  try {
    const matrix = await loadCapacityMatrix(parseCapacityQuery(req.nextUrl.searchParams));
    const buf = renderCapacityXlsx(matrix);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="capacity-${matrix.weeks[0]}.xlsx"`,
      },
    });
  } catch (err) {
    return handleApiError(err, 'Failed to export capacity');
  }
}
