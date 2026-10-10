import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { CATALOG_ROLES } from '@/lib/catalog/types';
import { loadImport, mutateImport } from '@/lib/catalog/import-store';
import { revision } from '@/lib/catalog/validation';
import { importError } from '@/lib/catalog/import-http';
import { writeAudit, clientIp } from '@/lib/audit';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
export async function GET(_req: NextRequest, context: Context) {
  const auth = await requireApiRole(CATALOG_ROLES);
  if (auth instanceof NextResponse) return auth;
  try {
    const rev = _req.nextUrl.searchParams.get('revision');
    return NextResponse.json(
      await loadImport((await context.params).id, rev === null ? undefined : revision(Number(rev))),
    );
  } catch (e) {
    return importError(e);
  }
}
export async function POST(req: NextRequest, context: Context) {
  const auth = await requireApiRole(CATALOG_ROLES);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json(),
      result = await mutateImport((await context.params).id, body, auth.userId);
    await writeAudit({
      actorType: 'user',
      actorId: auth.userId,
      action: `catalog.import.${body.action}`,
      entityType: 'catalogImport',
      entityId: result.id,
      ip: clientIp(req),
    });
    return NextResponse.json(result);
  } catch (e) {
    return importError(e);
  }
}
