import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { CATALOG_ROLES } from '@/lib/catalog/types';
import { createImport, listImports } from '@/lib/catalog/import-store';
import { MAX_IMPORT_BYTES } from '@/lib/catalog/import-parser';
import { importFormData } from '@/lib/catalog/import-body';
import { importError } from '@/lib/catalog/import-http';
import { SpecificationError } from '@/lib/specification/validation';
import { writeAudit, clientIp } from '@/lib/audit';
export const dynamic = 'force-dynamic';
export async function GET() {
  const auth = await requireApiRole(CATALOG_ROLES);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json(await listImports());
  } catch (e) {
    return importError(e);
  }
}
export async function POST(req: NextRequest) {
  const auth = await requireApiRole(CATALOG_ROLES);
  if (auth instanceof NextResponse) return auth;
  try {
    const form = await importFormData(req),
      file = form.get('file');
    if (!(file instanceof File) || file.size > MAX_IMPORT_BYTES)
      throw new SpecificationError('Требуется XLSX/CSV до 5 МБ');
    const result = await createImport(
      new Uint8Array(await file.arrayBuffer()),
      file.name,
      JSON.parse(String(form.get('profile') ?? '{}')),
      auth.userId,
    );
    await writeAudit({
      actorType: 'user',
      actorId: auth.userId,
      action: 'catalog.import.upload',
      entityType: 'catalogImport',
      entityId: result.id,
      ip: clientIp(req),
    });
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return importError(e);
  }
}
