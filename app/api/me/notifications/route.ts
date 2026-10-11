import { NextRequest, NextResponse } from 'next/server';
import { getInternalSession } from '@/lib/access';
import { handleApiError } from '@/lib/apiHelpers';
import { loadNotifications, markNotificationsRead } from '@/lib/review/notifications';

export const dynamic = 'force-dynamic';

/** Уведомления текущего сотрудника, непрочитанные сверху. */
export async function GET() {
  try {
    const session = await getInternalSession();
    if (!session) return NextResponse.json({ error: 'Требуется вход' }, { status: 401 });
    return NextResponse.json(await loadNotifications(session.userId));
  } catch (err) {
    return handleApiError(err, 'Failed to load notifications', 500);
  }
}

/**
 * Отметить прочитанными: `{ ids: string[] }` или `{ all: true }`. Отмечаются
 * только уведомления текущего пользователя — чужие id просто не совпадут.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getInternalSession();
    if (!session) return NextResponse.json({ error: 'Требуется вход' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    let target: string[] | 'all';
    if (body?.all === true) {
      target = 'all';
    } else if (
      Array.isArray(body?.ids) &&
      body.ids.every((id: unknown) => typeof id === 'string')
    ) {
      target = (body.ids as string[]).slice(0, 500);
    } else {
      return NextResponse.json({ error: 'Укажите ids: string[] или all: true' }, { status: 400 });
    }

    const marked = await markNotificationsRead(session.userId, target);
    return NextResponse.json({ marked });
  } catch (err) {
    return handleApiError(err, 'Failed to mark notifications read', 500);
  }
}
