import { NextRequest, NextResponse } from 'next/server';
import { getSession, requireApiRole } from '@/lib/auth';
import {
  approveVersion,
  archiveVersion,
  loadVersion,
  updateDraftVersion,
} from '@/lib/sizing/store';
import { SIZING_EDIT_ROLES } from '@/lib/sizing/types';
import { sizingError } from '@/lib/sizing/http';
import { SizingError } from '@/lib/sizing/engine';
import { clientIp, writeAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ versionId: string }> };

export async function GET(_req: NextRequest, context: Context) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Требуется вход в систему' }, { status: 401 });
    const { versionId } = await context.params;
    const version = await loadVersion(versionId);
    if (version.status === 'draft' && !SIZING_EDIT_ROLES.includes(session.role))
      return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 });
    return NextResponse.json(version, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return sizingError(error);
  }
}

/** Правка черновика. Утвержденная версия неизменяема (409). */
export async function PATCH(req: NextRequest, context: Context) {
  try {
    const auth = await requireApiRole(SIZING_EDIT_ROLES);
    if (auth instanceof NextResponse) return auth;
    const { versionId } = await context.params;
    return NextResponse.json(await updateDraftVersion(versionId, await req.json()));
  } catch (error) {
    return sizingError(error);
  }
}

/** { action: 'approve' | 'archive' }. */
export async function POST(req: NextRequest, context: Context) {
  try {
    const auth = await requireApiRole(SIZING_EDIT_ROLES);
    if (auth instanceof NextResponse) return auth;
    const { versionId } = await context.params;
    const body = await req.json();
    let result;
    if (body?.action === 'approve') result = await approveVersion(versionId, auth.userId);
    else if (body?.action === 'archive') result = await archiveVersion(versionId);
    else throw new SizingError('Неизвестное действие');
    await writeAudit({
      actorType: 'user',
      actorId: auth.userId,
      action: `sizing.version.${body.action}`,
      entityType: 'sizingProfileVersion',
      entityId: versionId,
      meta: { profile: result.profileKey, version: result.version },
      ip: clientIp(req),
    });
    return NextResponse.json(result);
  } catch (error) {
    return sizingError(error);
  }
}
