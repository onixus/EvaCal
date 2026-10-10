import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { CATALOG_ROLES } from '@/lib/catalog/types';
import { compareImports } from '@/lib/catalog/import-comparison';
import { importError } from '@/lib/catalog/import-http';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  const auth = await requireApiRole(CATALOG_ROLES);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json(
      await compareImports(
        req.nextUrl.searchParams.get('before') ?? '',
        req.nextUrl.searchParams.get('after') ?? '',
      ),
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return importError(error);
  }
}
