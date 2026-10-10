import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { CATALOG_ROLES } from '@/lib/catalog/types';
import { listImportProfiles, mutateImportProfile } from '@/lib/catalog/import-profiles';
import { importError } from '@/lib/catalog/import-http';
import { writeAudit, clientIp } from '@/lib/audit';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  const auth = await requireApiRole(CATALOG_ROLES);
  if (auth instanceof NextResponse) return auth;
  try {
    const vendorId = req.nextUrl.searchParams.get('vendorId');
    return NextResponse.json(await listImportProfiles(vendorId ?? undefined), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (e) {
    return importError(e);
  }
}
export async function POST(req: NextRequest) {
  const auth = await requireApiRole(CATALOG_ROLES);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json(),
      result = await mutateImportProfile(body, auth.userId);
    await writeAudit({
      actorType: 'user',
      actorId: auth.userId,
      action: `catalog.importProfile.${body.action}`,
      entityType: 'catalogImportProfile',
      entityId: result.id,
      ip: clientIp(req),
    });
    return NextResponse.json(result, { status: body.action === 'create' ? 201 : 200 });
  } catch (e) {
    return importError(e);
  }
}
