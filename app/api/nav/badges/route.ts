import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getInternalSession } from '@/lib/access';
import { hasArchitectPowers, isGapRole, isTechWriterRole } from '@/lib/appRoles';
import { handleApiError } from '@/lib/apiHelpers';

/**
 * Счётчики у пунктов навигации. Считаются по ролям: тех.писатель и рецензент
 * видят очередь нормоконтроля, ГАП и архитектор — очередь финального ревью, а
 * архитектор дополнительно незакрытые черновики студии.
 *
 * Гостю по share-ссылке счётчики не выдаются: это агрегат по всему архиву, а
 * ссылка ограничена одним расчётом.
 */
export async function GET() {
  try {
    const session = await getInternalSession();
    if (!session) return NextResponse.json({ badges: {} });

    const badges: Record<string, number> = {};

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
