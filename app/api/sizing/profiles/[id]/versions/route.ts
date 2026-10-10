import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { createVersion, setProfileArchived } from '@/lib/sizing/store';
import { SIZING_EDIT_ROLES } from '@/lib/sizing/types';
import { sizingError } from '@/lib/sizing/http';
import { SizingError } from '@/lib/sizing/engine';
import { clientIp, writeAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };

/**
 * POST — новая черновая версия профиля (rules, assumptions, source).
 * PATCH { archived } — архивировать/восстановить профиль целиком.
 */
export async function POST(req: NextRequest, context: Context) {
  try {
    const auth = await requireApiRole(SIZING_EDIT_ROLES);
    if (auth instanceof NextResponse) return auth;
    const { id } = await context.params;
    const version = await createVersion(id, await req.json(), auth.userId);
    await writeAudit({
      actorType: 'user',
      actorId: auth.userId,
      action: 'sizing.version.create',
      entityType: 'sizingProfile',
      entityId: id,
      meta: { versionId: version.id, version: version.version },
      ip: clientIp(req),
    });
    return NextResponse.json(version, { status: 201 });
  } catch (error) {
    return sizingError(error);
  }
}

export async function PATCH(req: NextRequest, context: Context) {
  try {
    const auth = await requireApiRole(SIZING_EDIT_ROLES);
    if (auth instanceof NextResponse) return auth;
    const { id } = await context.params;
    const body = await req.json();
    if (typeof body?.archived !== 'boolean') throw new SizingError('archived: логическое значение');
    return NextResponse.json(await setProfileArchived(id, body.archived));
  } catch (error) {
    return sizingError(error);
  }
}
