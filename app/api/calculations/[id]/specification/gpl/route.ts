import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { requireCalcAccess } from '@/lib/access';
import { CATALOG_ROLES } from '@/lib/catalog/types';
import { object, revision, text } from '@/lib/catalog/validation';
import { applyGplUpdate, previewGplUpdate } from '@/lib/specification/gpl-updates';
import { parseGplSelections } from '@/lib/specification/gpl-update-selection';
import { importError } from '@/lib/catalog/import-http';
import { SpecificationError } from '@/lib/specification/validation';
import { clientIp, writeAudit } from '@/lib/audit';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
async function gate(req: NextRequest, context: Context) {
  const auth = await requireApiRole(CATALOG_ROLES);
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params,
    access = await requireCalcAccess(req, id, ['write']);
  if (access instanceof NextResponse) return access;
  if (access.kind !== 'staff')
    return NextResponse.json({ error: 'Требуется доступ сотрудника' }, { status: 403 });
  return { id, actorId: auth.userId };
}
export async function GET(req: NextRequest, context: Context) {
  try {
    const access = await gate(req, context);
    if (access instanceof NextResponse) return access;
    return NextResponse.json(
      await previewGplUpdate(access.id, req.nextUrl.searchParams.get('targetImportId') ?? ''),
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (e) {
    return importError(e);
  }
}
export async function POST(req: NextRequest, context: Context) {
  try {
    const access = await gate(req, context);
    if (access instanceof NextResponse) return access;
    const body = object(await req.json());
    if (body.action === 'preview')
      return NextResponse.json(
        await previewGplUpdate(
          access.id,
          text(body.targetImportId, 'GPL', 100, true),
          parseGplSelections(body.selections),
          {
            version: revision(body.version),
            targetRevision: revision(body.targetRevision),
            targetChecksum: text(body.targetChecksum, 'SHA-256', 64, true),
          },
        ),
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    if (body.action !== 'apply') throw new SpecificationError('Неизвестное действие');
    const saved = await applyGplUpdate(access.id, body, access.actorId);
    await writeAudit({
      actorType: 'user',
      actorId: access.actorId,
      action: 'specification.gpl.apply',
      entityType: 'calculation',
      entityId: access.id,
      meta: { version: saved.snapshot.version, targetImportId: body.targetImportId },
      ip: clientIp(req),
    });
    return NextResponse.json(saved, {
      status: 201,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (e) {
    return importError(e);
  }
}
