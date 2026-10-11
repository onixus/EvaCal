import { NextResponse } from 'next/server';
import { getInternalSession } from '@/lib/access';
import { handleApiError } from '@/lib/apiHelpers';
import { loadMyQueue } from '@/lib/review/queue';
import { actorFromSession } from '@/lib/review/workflow';

export const dynamic = 'force-dynamic';

/**
 * Очередь «Требует моего действия»: персональные задачи и уведомления
 * текущего сотрудника. Просрочки дописываются в уведомления при чтении.
 * Гостю по share-ссылке очередь не выдаётся — у него нет учётной записи.
 */
export async function GET() {
  try {
    const session = await getInternalSession();
    if (!session) return NextResponse.json({ error: 'Требуется вход' }, { status: 401 });
    return NextResponse.json(await loadMyQueue(actorFromSession(session)));
  } catch (err) {
    return handleApiError(err, 'Failed to load my queue', 500);
  }
}
