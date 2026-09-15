import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/auth';
import { openBlockerCount, parseChecklist, parseComments } from '@/lib/gost34/review/types';
import { grandTotalHours } from '@/lib/totals';
import BoardClient, { type BoardCard, type EstimateCard } from './BoardClient';

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
  const [rows, calcRows] = await Promise.all([
    prisma.gostPackage.findMany({
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
        stageEnteredAt: true,
        project: { select: { id: true, name: true, code: true, customer: true } },
        calculation: { select: { customer: true, name: true } },
      },
    }),
    // Сметы: черновики пресейла, ожидающие утверждения архитектором и недавно
    // утверждённые. Утверждённая смета — вход в конвейер комплекта, поэтому
    // старые утверждённые не показываем: они уже живут в колонках комплектов.
    prisma.calculation.findMany({
      where: {
        OR: [
          { status: { in: ['draft', 'pending_approval'] } },
          { status: 'approved', updatedAt: { gte: approvedSince } },
        ],
      },
      orderBy: [{ updatedAt: 'asc' }],
      take: 300,
      select: {
        id: true,
        name: true,
        customer: true,
        version: true,
        status: true,
        createdBy: true,
        createdAt: true,
        updatedAt: true,
        stageEnteredAt: true,
        pmHours: true,
        template: { select: { name: true } },
        project: { select: { id: true, code: true } },
        stages: { select: { hours: true, isApprovalTask: true } },
        risks: { select: { hours: true } },
      },
    }),
  ]);

  // releasedBy/approvedBy хранят id пользователя, createdBy — логин; показываем логин.
  const actorIds = Array.from(
    new Set(
      [
        ...rows.flatMap((p) => [p.releasedBy, p.createdBy, p.approvedBy]),
        ...calcRows.map((c) => c.createdBy),
      ].filter((v): v is string => Boolean(v)),
    ),
  );
  const users = actorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, username: true },
      })
    : [];
  const usernameById = new Map(users.map((u) => [u.id, u.username]));
  const nameOf = (value: string | null): string | null =>
    value ? (usernameById.get(value) ?? value) : null;

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
    author: nameOf(p.releasedBy ?? p.createdBy) ?? p.createdBy,
    approvedBy: nameOf(p.approvedBy),
    // Момент попадания в текущую колонку: выпуск — для нормоконтроля,
    // последнее изменение — для остальных.
    enteredAt: (
      p.stageEnteredAt ??
      (p.status === 'under_review' && p.reviewStage !== 'gap'
        ? (p.releasedAt ?? p.updatedAt)
        : p.status === 'approved'
          ? (p.approvedAt ?? p.updatedAt)
          : p.updatedAt)
    ).toISOString(),
  }));

  const estimates: EstimateCard[] = calcRows.map((c) => ({
    id: c.id,
    name: c.name,
    customer: c.customer,
    version: c.version,
    status: c.status,
    author: nameOf(c.createdBy) ?? c.createdBy,
    template: c.template.name,
    totalHours: Math.round(grandTotalHours(c.stages, c.pmHours, c.risks) * 10) / 10,
    project: c.project ? { id: c.project.id, code: c.project.code } : null,
    enteredAt: (c.stageEnteredAt ?? c.updatedAt).toISOString(),
  }));

  return (
    <BoardClient
      cards={cards}
      estimates={estimates}
      role={session.role}
      username={session.username}
    />
  );
}
