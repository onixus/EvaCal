import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getInternalSession } from '@/lib/access';
import { hasArchitectPowers, isGapRole, isTechWriterRole, navItemsFor } from '@/lib/appRoles';
import { handleApiError } from '@/lib/apiHelpers';
import { loadQueueBadge } from '@/lib/review/queue';
import { actorFromSession } from '@/lib/review/workflow';

/**
 * Счётчики у пунктов навигации. Считаются по ролям: тех.писатель и рецензент
 * видят очередь нормоконтроля, ГАП и архитектор — очередь финального ревью, а
 * архитектор дополнительно незакрытые черновики студии.
 *
 * «Требует моего действия» (`myQueue`) — личный счётчик ролей с пунктом
 * `/inbox`: различимые дела — задачи и непрочитанные уведомления о других
 * сущностях; `myQueueOverdue` — сколько задач просрочено. Просрочки
 * дописываются в уведомления здесь же (не чаще окна кэша на процесс).
 *
 * Гостю по share-ссылке счётчики не выдаются: это агрегат по всему архиву, а
 * ссылка ограничена одним расчётом.
 */
export async function GET() {
  try {
    const session = await getInternalSession();
    if (!session) return NextResponse.json({ badges: {} });

    const badges: Record<string, number> = {};

    // Роли без пункта «Требует моего действия» (пресейл) очередь не считают.
    if (navItemsFor(session.role).some((item) => item.href === '/inbox')) {
      const queue = await loadQueueBadge(actorFromSession(session));
      badges.myQueue = queue.count;
      badges.myQueueOverdue = queue.overdue;
    }

    if (isTechWriterRole(session.role) || session.role === 'admin') {
      badges.reviewQueue = await prisma.gostPackage.count({
        where: { status: 'under_review', reviewStage: 'tw' },
      });
    }

    if (isGapRole(session.role)) {
      badges.gapQueue = await prisma.gostPackage.count({
        where: { status: 'under_review', reviewStage: 'gap' },
      });
    }

    if (hasArchitectPowers(session.role)) {
      const [studioDrafts, studioRejected] = await Promise.all([
        prisma.gostPackage.count({ where: { status: 'draft' } }),
        prisma.gostPackage.count({ where: { status: 'rejected' } }),
      ]);
      // В Студии архитектор работает с незавершёнными черновиками и комплектами,
      // возвращёнными с замечаниями нормоконтроля.
      badges.studioDrafts = studioDrafts + studioRejected;
      badges.studioRejected = studioRejected;
    }

    return NextResponse.json({ badges });
  } catch (err) {
    return handleApiError(err, 'Failed to load navigation badges', 500);
  }
}
