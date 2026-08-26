import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getInternalSession } from '@/lib/access';
import { hasArchitectPowers, hasReviewerPowers } from '@/lib/appRoles';
import { handleApiError } from '@/lib/apiHelpers';

/**
 * Счётчики у пунктов навигации. Считаются по ролям: ревьювер видит очередь
 * первого этапа, архитектор — очередь ГАП и незакрытые черновики студии.
 *
 * Гостю по share-ссылке счётчики не выдаются: это агрегат по всему архиву, а
 * ссылка ограничена одним расчётом.
 */
export async function GET() {
  try {
    const session = await getInternalSession();
    if (!session) return NextResponse.json({ badges: {} });

    const badges: Record<string, number> = {};

    if (hasReviewerPowers(session.role)) {
      badges.reviewQueue = await prisma.gostPackage.count({
        where: { status: 'under_review', reviewStage: 'tw' },
      });
    }

    if (hasArchitectPowers(session.role)) {
      const [gapQueue, studioDrafts] = await Promise.all([
        prisma.gostPackage.count({ where: { status: 'under_review', reviewStage: 'gap' } }),
        prisma.gostPackage.count({ where: { status: 'draft' } }),
      ]);
      badges.gapQueue = gapQueue;
      badges.studioDrafts = studioDrafts;
    }

    return NextResponse.json({ badges });
  } catch (err) {
    return handleApiError(err, 'Failed to load navigation badges', 500);
  }
}
