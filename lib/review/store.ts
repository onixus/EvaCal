/**
 * Хранилище назначений и замечаний ревью (#103 WP-3a).
 *
 * Замечания живут в таблице `ReviewComment`; JSON-столбец
 * `GostPackage.reviewComments` остаётся резервом только для чтения — он
 * подхватывается, лишь когда у комплекта нет ни одной строки (например,
 * комментарий записан старым кодом уже после миграции).
 *
 * Незакрытые замечания переходят по линии комплекта: замечание к v1, не
 * проверенное и не отклонённое, видно и блокирует утверждение v2, пока роль
 * этапа или автор не закроет его — иначе новая версия «обнуляла» бы блокеры.
 */
import { prisma } from '@/lib/prisma';
import {
  isCommentResolved,
  openBlockerCount,
  parseChecklist,
  parseComments,
  type CommentSeverity,
  type CommentStatus,
  type SectionComment,
} from '@/lib/gost34/review/types';
import type { AssignableStage } from './workflow';

export interface ReviewPackageRef {
  id: string;
  projectId: string | null;
  version: number;
  reviewComments?: string | null;
  reviewChecklist?: string | null;
}

interface CommentRow {
  id: string;
  packageId: string;
  stage: string;
  sectionId: string;
  severity: string;
  text: string;
  author: string;
  authorId: string | null;
  createdAt: Date;
  status: string;
  fixedBy: string | null;
  fixedAt: Date | null;
  fixedInPackageId: string | null;
  fixedInVersion: number | null;
  verifiedBy: string | null;
  verifiedAt: Date | null;
  package?: { version: number } | null;
  replies?: { id: string; text: string; author: string; createdAt: Date }[];
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function serializeComment(row: CommentRow): SectionComment {
  return {
    id: row.id,
    packageId: row.packageId,
    packageVersion: row.package?.version,
    stage: row.stage === 'gap' ? 'gap' : 'tw',
    sectionId: row.sectionId,
    severity: row.severity as CommentSeverity,
    text: row.text,
    author: row.author,
    authorId: row.authorId,
    createdAt: row.createdAt.toISOString(),
    status: row.status as CommentStatus,
    fixedBy: row.fixedBy,
    fixedAt: iso(row.fixedAt),
    fixedInPackageId: row.fixedInPackageId,
    fixedInVersion: row.fixedInVersion,
    verifiedBy: row.verifiedBy,
    verifiedAt: iso(row.verifiedAt),
    replies: (row.replies ?? []).map((r) => ({
      id: r.id,
      text: r.text,
      author: r.author,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

/**
 * Условие «замечания, относящиеся к комплекту»: свои — все, из более ранних
 * версий линии — незакрытые и те, что исправлены именно в этом комплекте.
 */
function lineageWhere(pkg: ReviewPackageRef) {
  const own = { packageId: pkg.id };
  if (!pkg.projectId) return own;
  return {
    OR: [
      own,
      { fixedInPackageId: pkg.id },
      {
        status: { in: ['open', 'fixed'] },
        package: { projectId: pkg.projectId, version: { lt: pkg.version } },
      },
    ],
  };
}

function legacyFallback(pkg: ReviewPackageRef): SectionComment[] {
  return parseComments(pkg.reviewComments).map((c) => ({
    ...c,
    status: 'open' as const,
    packageId: pkg.id,
    packageVersion: pkg.version,
    replies: [],
    legacy: true,
  }));
}

/** Замечания комплекта с ответами, включая перенесённые из ранних версий. */
export async function loadReviewComments(pkg: ReviewPackageRef): Promise<SectionComment[]> {
  const rows = (await prisma.reviewComment.findMany({
    where: lineageWhere(pkg),
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: {
      package: { select: { version: true } },
      replies: { orderBy: { createdAt: 'asc' } },
    },
  })) as CommentRow[];
  const comments = rows.map(serializeComment);
  const hasOwn = rows.some((r) => r.packageId === pkg.id);
  return hasOwn ? comments : [...comments, ...legacyFallback(pkg)];
}

/** Открытые блокеры комплекта: незакрытые замечания-блокеры и проваленный чек-лист. */
export async function countOpenBlockers(pkg: ReviewPackageRef): Promise<number> {
  const comments = await loadReviewComments(pkg);
  return openBlockerCount(comments, parseChecklist(pkg.reviewChecklist));
}

export interface ReviewSummary {
  /** Незакрытые блокеры и проваленные пункты чек-листа. */
  openBlockers: number;
  /** Все незакрытые замечания любой серьёзности. */
  openComments: number;
}

/**
 * Сводка ревью для списка комплектов (доска, студия) — одним запросом,
 * по тем же правилам, что и при утверждении.
 */
export async function summarizeReviewBulk(
  packages: ReviewPackageRef[],
): Promise<Map<string, ReviewSummary>> {
  const result = new Map<string, ReviewSummary>();
  if (packages.length === 0) return result;
  const ids = packages.map((p) => p.id);
  const projectIds = Array.from(
    new Set(packages.map((p) => p.projectId).filter((v): v is string => Boolean(v))),
  );
  const rows = await prisma.reviewComment.findMany({
    where: {
      OR: [
        { packageId: { in: ids } },
        { fixedInPackageId: { in: ids } },
        ...(projectIds.length
          ? [{ status: { in: ['open', 'fixed'] }, package: { projectId: { in: projectIds } } }]
          : []),
      ],
    },
    select: {
      packageId: true,
      severity: true,
      status: true,
      fixedInPackageId: true,
      package: { select: { projectId: true, version: true } },
    },
  });
  for (const pkg of packages) {
    const related = rows.filter(
      (r) =>
        r.packageId === pkg.id ||
        r.fixedInPackageId === pkg.id ||
        (pkg.projectId &&
          r.package.projectId === pkg.projectId &&
          r.package.version < pkg.version &&
          (r.status === 'open' || r.status === 'fixed')),
    );
    const hasOwn = related.some((r) => r.packageId === pkg.id);
    const comments: Pick<SectionComment, 'severity' | 'status'>[] = [
      ...related.map((r) => ({
        severity: r.severity as CommentSeverity,
        status: r.status as CommentStatus,
      })),
      ...(hasOwn ? [] : legacyFallback(pkg)),
    ];
    const unresolved = comments.filter((c) => !isCommentResolved(c));
    result.set(pkg.id, {
      openBlockers: openBlockerCount(
        unresolved as SectionComment[],
        parseChecklist(pkg.reviewChecklist),
      ),
      openComments: unresolved.length,
    });
  }
  return result;
}

export interface SerializedAssignment {
  id: string;
  packageId: string;
  stage: AssignableStage;
  assigneeId: string;
  assigneeName: string;
  deputyId: string | null;
  deputyName: string | null;
  dueAt: string;
  assignedBy: string;
  assignedAt: string;
  active: boolean;
}

interface AssignmentRow {
  id: string;
  packageId: string;
  stage: string;
  assigneeId: string;
  deputyId: string | null;
  dueAt: Date;
  assignedBy: string;
  assignedAt: Date;
  active: boolean;
}

async function withUsernames(rows: AssignmentRow[]): Promise<SerializedAssignment[]> {
  const ids = Array.from(
    new Set(rows.flatMap((r) => [r.assigneeId, r.deputyId, r.assignedBy]).filter(Boolean)),
  ) as string[];
  const users = ids.length
    ? await prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, username: true },
      })
    : [];
  const name = new Map(users.map((u) => [u.id, u.username]));
  return rows.map((r) => ({
    id: r.id,
    packageId: r.packageId,
    stage: r.stage === 'gap' ? 'gap' : 'tw',
    assigneeId: r.assigneeId,
    assigneeName: name.get(r.assigneeId) ?? r.assigneeId,
    deputyId: r.deputyId,
    deputyName: r.deputyId ? (name.get(r.deputyId) ?? r.deputyId) : null,
    dueAt: r.dueAt.toISOString(),
    assignedBy: name.get(r.assignedBy) ?? r.assignedBy,
    assignedAt: r.assignedAt.toISOString(),
    active: r.active,
  }));
}

/** Активные назначения по комплектам: ключ — `${packageId}:${stage}`. */
export async function loadActiveAssignments(
  packageIds: string[],
): Promise<Map<string, SerializedAssignment>> {
  const map = new Map<string, SerializedAssignment>();
  if (packageIds.length === 0) return map;
  const rows = await prisma.reviewAssignment.findMany({
    where: { packageId: { in: packageIds }, active: true },
  });
  for (const a of await withUsernames(rows)) map.set(`${a.packageId}:${a.stage}`, a);
  return map;
}

/** История назначений комплекта, новые сверху. */
export async function loadAssignmentHistory(packageId: string): Promise<SerializedAssignment[]> {
  const rows = await prisma.reviewAssignment.findMany({
    where: { packageId },
    orderBy: { assignedAt: 'desc' },
  });
  return withUsernames(rows);
}

/**
 * Назначить ответственного. Предыдущее активное назначение этапа снимается
 * в той же транзакции; частичный уникальный индекс не даст двум активным
 * назначениям появиться и при гонке.
 */
export async function assignReviewStage(input: {
  packageId: string;
  stage: AssignableStage;
  assigneeId: string;
  deputyId: string | null;
  dueAt: Date;
  assignedBy: string;
}): Promise<SerializedAssignment> {
  const row = await prisma.$transaction(async (tx) => {
    await tx.reviewAssignment.updateMany({
      where: { packageId: input.packageId, stage: input.stage, active: true },
      data: { active: false },
    });
    return tx.reviewAssignment.create({ data: { ...input, active: true } });
  });
  const [serialized] = await withUsernames([row]);
  return serialized;
}

/** Снять активное назначение этапа. */
export async function clearReviewStageAssignment(packageId: string, stage: AssignableStage) {
  return prisma.reviewAssignment.updateMany({
    where: { packageId, stage, active: true },
    data: { active: false },
  });
}

/** Пользователи, которых можно назначить на этап: роль этапа. */
export async function loadAssignmentCandidates(roles: string[]) {
  return prisma.user.findMany({
    where: { role: { in: roles } },
    select: { id: true, username: true, role: true },
    orderBy: { username: 'asc' },
  });
}
