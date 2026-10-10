import { NextRequest, NextResponse } from 'next/server';
import { getSession, requireApiRole } from '@/lib/auth';
import { createProfile, listProfiles } from '@/lib/sizing/store';
import { SIZING_EDIT_ROLES } from '@/lib/sizing/types';
import { sizingError } from '@/lib/sizing/http';
import { clientIp, writeAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/** Профили и версии сайзинга: читают сотрудники, изменяют архитектор и администратор. */
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Требуется вход в систему' }, { status: 401 });
    const canEdit = SIZING_EDIT_ROLES.includes(session.role);
    const archived = canEdit && req.nextUrl.searchParams.get('archived') === '1';
    const profiles = await listProfiles(archived);
    return NextResponse.json(
      {
        profiles: canEdit
          ? profiles
          : profiles.map((p) => ({
              ...p,
              versions: p.versions.filter((v) => v.status === 'approved'),
            })),
        canEdit,
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return sizingError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiRole(SIZING_EDIT_ROLES);
    if (auth instanceof NextResponse) return auth;
    const profile = await createProfile(await req.json(), auth.userId);
    await writeAudit({
      actorType: 'user',
      actorId: auth.userId,
      action: 'sizing.profile.create',
      entityType: 'sizingProfile',
      entityId: profile.id,
      meta: { key: profile.key },
      ip: clientIp(req),
    });
    return NextResponse.json(profile, { status: 201 });
  } catch (error) {
    return sizingError(error);
  }
}
