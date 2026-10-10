import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { CATALOG_ROLES } from '@/lib/catalog/types';
import { importAttachment } from '@/lib/catalog/import-store';
import { importError } from '@/lib/catalog/import-http';
export const dynamic = 'force-dynamic';
export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(CATALOG_ROLES);
  if (auth instanceof NextResponse) return auth;
  try {
    const file = await importAttachment((await context.params).id);
    return new NextResponse(new Uint8Array(file.file), {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
        'X-Content-SHA256': file.checksum,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (e) {
    return importError(e);
  }
}
