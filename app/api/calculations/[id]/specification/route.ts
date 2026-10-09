import { NextRequest, NextResponse } from 'next/server';
import { requireCalcAccess } from '@/lib/access';
import { loadSpecification, saveSpecification } from '@/lib/specification/store';
import { SpecificationError } from '@/lib/specification/validation';
import { handleApiError } from '@/lib/apiHelpers';
import { actorTypeFromAccess, clientIp, writeAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';
type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, props: Params) {
  try {
    const { id } = await props.params;
    const access = await requireCalcAccess(req, id, ['read']);
    if (access instanceof NextResponse) return access;
    const raw = req.nextUrl.searchParams.get('version');
    if (
      raw !== null &&
      (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1)
    ) {
      throw new SpecificationError('Некорректная версия');
    }
    return NextResponse.json({
      specification: await loadSpecification(id, raw === null ? undefined : Number(raw)),
      canWrite:
        access.kind === 'anonymous' ||
        (access.kind === 'staff' &&
          ['admin', 'architect', 'presale'].includes(access.session?.role || '')) ||
        Boolean(access.share?.scopes.includes('write')),
      canExport: access.kind !== 'share' || Boolean(access.share?.scopes.includes('export')),
    });
  } catch (error) {
    return handleApiError(
      error,
      'Не удалось загрузить спецификацию',
      error instanceof SpecificationError ? error.statusCode : 500,
    );
  }
}

export async function POST(req: NextRequest, props: Params) {
  try {
    const { id } = await props.params;
    const access = await requireCalcAccess(req, id, ['write']);
    if (access instanceof NextResponse) return access;
    const result = await saveSpecification(id, await req.json(), access.actorId);
    await writeAudit({
      actorType: actorTypeFromAccess(access.kind),
      actorId: access.actorId,
      action: 'specification.save',
      entityType: 'calculation',
      entityId: id,
      meta: { version: result.snapshot.version, status: result.snapshot.status },
      ip: clientIp(req),
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(
      error,
      'Не удалось сохранить спецификацию',
      error instanceof SpecificationError
        ? error.statusCode
        : error instanceof SyntaxError
          ? 400
          : 500,
    );
  }
}
