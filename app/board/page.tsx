import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/auth';
import { openBlockerCount, parseChecklist, parseComments } from '@/lib/gost34/review/types';
import BoardClient, { type BoardCard } from './BoardClient';

export const dynamic = 'force-dynamic';

const APPROVED_WINDOW_DAYS = 30;

/**
 * Канбан комплектов ГОСТ 34: колонки — этапы выпуска, карточки — комплекты.
 * Архитектор видит свои черновики и возвраты, тех.писатель — нормоконтроль,
 * ГАП — финальное ревью; каждый двигает карточку только на своём этапе.
 */
export default async function BoardPage() {
  const session = await requireRole(
    ['architect', 'techwriter', 'gap', 'reviewer', 'admin'],
    '/board',
  );

  const approvedSince = new Date(Date.now() - APPROVED_WINDOW_DAYS * 86_400_000);
  const rows = await prisma.gostPackage.findMany({
    where: {
      OR: [
        { status: { in: ['draft', 'under_review', 'rejected'] } },
        { status: 'approved', approvedAt: { gte: approvedSince } },
      ],
    },
    orderBy: [{ updatedAt: 'desc' }],
    take: 300,
    select: {
      id: true,
      name: true,
      version: true,
      status: true,
      reviewStage: true,
      reviewComment: true,
      reviewComments: true,
      reviewChecklist: true,
      releasedAt: true,
      releasedBy: true,
      approvedAt: true,
      approvedBy: true,
      createdBy: true,
      createdAt: true,
      updatedAt: true,
      calculationId: true,
      project: { select: { id: true, name: true, code: true, customer: true } },
      calculation: { select: { customer: true, name: true } },
    },
  });

  // releasedBy/createdBy хранят id пользователя или логин — показываем логин.
  const actorIds = Array.from(
    new Set(rows.flatMap((p) => [p.releasedBy, p.createdBy, p.approvedBy]).filter(Boolean)),
  ) as string[];
  const users = actorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, username: true },
      })
    : [];
  const nameOf = (value: string | null) =>
    value ? (users.find((u) => u.id === value)?.username ?? value) : null;

  const cards: BoardCard[] = rows.map((p) => ({
    id: p.id,
    name: p.name,
    version: p.version,
    status: p.status,
    reviewStage: p.reviewStage === 'gap' ? 'gap' : p.reviewStage === 'done' ? 'done' : 'tw',
    reviewComment: p.reviewComment,
    openBlockers: openBlockerCount(
      parseComments(p.reviewComments),
      parseChecklist(p.reviewChecklist),
    ),
    calculationId: p.calculationId,
    project: p.project
      ? { id: p.project.id, name: p.project.name, code: p.project.code }
      : { id: null, name: p.calculation.name, code: null },
    customer: p.project?.customer ?? p.calculation.customer,
    author: nameOf(p.releasedBy) ?? nameOf(p.createdBy) ?? p.createdBy,
    approvedBy: nameOf(p.approvedBy),
    // Момент попадания в текущую колонку: выпуск — для нормоконтроля,
    // последнее изменение — для остальных.
    enteredAt: (p.status === 'under_review' && p.reviewStage !== 'gap'
      ? (p.releasedAt ?? p.updatedAt)
      : p.status === 'approved'
        ? (p.approvedAt ?? p.updatedAt)
        : p.updatedAt
    ).toISOString(),
  }));

  return <BoardClient cards={cards} role={session.role} username={session.username} />;
}
