import type { Prisma } from '../generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { safeJsonParse } from '@/lib/json';
import {
  computeChangeImpact,
  requirementsFromSnapshot,
  snapshotAffectedRequirements,
} from './impact';
import type {
  AffectedRequirement,
  ChangeEstimate,
  ChangeImpact,
  ChangeRequestAction,
  ChangeRequestStatus,
  ProposedChanges,
} from './types';
import {
  ChangeRequestError,
  canEditContent,
  canEstimate,
  transitionError,
  type ChangeRequestDraftInput,
} from './workflow';

/**
 * Хранилище запросов на изменение. Всё, что здесь пишется, — только строки
 * ChangeRequest/ChangeRequestEvent: базовые расчёт, этапы и комплект читаются,
 * но не меняются (это проверяют routes.test.ts и verify-change-requests.ts).
 */

export interface ChangeRequestEventDto {
  id: string;
  action: ChangeRequestAction;
  actor: string;
  comment: string | null;
  data: unknown;
  at: string;
}

export interface ChangeRequestDto {
  id: string;
  projectId: string;
  seq: number;
  title: string;
  initiator: string;
  reason: string;
  status: ChangeRequestStatus;
  baseCalculationId: string;
  basePackageId: string | null;
  affectedRequirements: AffectedRequirement[];
  proposedChanges: ProposedChanges;
  impact: ChangeImpact | null;
  confirmedHours: number | null;
  confirmedCost: string | null;
  confirmedScheduleDays: number | null;
  estimateComment: string | null;
  estimatedBy: string | null;
  estimatedAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  resultCalculationId: string | null;
  resultPackageId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  events?: ChangeRequestEventDto[];
}

type ChangeRequestRow = Prisma.ChangeRequestGetPayload<object>;
type EventRow = Prisma.ChangeRequestEventGetPayload<object>;

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export function toEventDto(row: EventRow): ChangeRequestEventDto {
  return {
    id: row.id,
    action: row.action as ChangeRequestAction,
    actor: row.actor,
    comment: row.comment,
    data: row.data ?? null,
    at: row.at.toISOString(),
  };
}

export function toChangeRequestDto(
  row: ChangeRequestRow & { events?: EventRow[] },
): ChangeRequestDto {
  const proposed = (row.proposedChanges ?? {}) as Partial<ProposedChanges>;
  return {
    id: row.id,
    projectId: row.projectId,
    seq: row.seq,
    title: row.title,
    initiator: row.initiator,
    reason: row.reason,
    status: row.status as ChangeRequestStatus,
    baseCalculationId: row.baseCalculationId,
    basePackageId: row.basePackageId,
    affectedRequirements: Array.isArray(row.affectedRequirements)
      ? (row.affectedRequirements as unknown as AffectedRequirement[])
      : [],
    proposedChanges: {
      summary: typeof proposed.summary === 'string' ? proposed.summary : '',
      items: Array.isArray(proposed.items) ? proposed.items : [],
    },
    impact: (row.impact as unknown as ChangeImpact | null) ?? null,
    confirmedHours: row.confirmedHours,
    confirmedCost: row.confirmedCost === null ? null : row.confirmedCost.toFixed(2),
    confirmedScheduleDays: row.confirmedScheduleDays,
    estimateComment: row.estimateComment,
    estimatedBy: row.estimatedBy,
    estimatedAt: iso(row.estimatedAt),
    decidedBy: row.decidedBy,
    decidedAt: iso(row.decidedAt),
    resultCalculationId: row.resultCalculationId,
    resultPackageId: row.resultPackageId,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(row.events ? { events: row.events.map(toEventDto) } : {}),
  };
}

async function requireProject(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) throw new ChangeRequestError('Проект не найден', 404);
}

function docTypes(raw: string | null | undefined): string[] {
  const parsed = safeJsonParse<unknown>(raw ?? null, []);
  return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
}

async function loadBasePackage(projectId: string, packageId: string) {
  const pkg = await prisma.gostPackage.findFirst({
    where: { id: packageId, projectId },
    select: { id: true, version: true, calculationId: true, documentTypes: true, snapshot: true },
  });
  if (!pkg) throw new ChangeRequestError('Базовый комплект не найден в проекте', 400);
  return {
    id: pkg.id,
    version: pkg.version,
    calculationId: pkg.calculationId,
    documentTypes: docTypes(pkg.documentTypes),
    snapshot: safeJsonParse<unknown>(pkg.snapshot ?? null, {}),
  };
}

/** Требования базового комплекта для выбора затронутых. */
export async function loadBaseRequirements(
  projectId: string,
  packageId: string,
): Promise<AffectedRequirement[]> {
  await requireProject(projectId);
  const pkg = await loadBasePackage(projectId, packageId);
  return requirementsFromSnapshot(pkg.snapshot);
}

/**
 * Проверяет базу (расчёт и комплект того же проекта, комплект выпущен по этому
 * расчёту), снимает затронутые требования и считает связанные работы. Только
 * чтение.
 */
async function resolveDraft(projectId: string, input: ChangeRequestDraftInput) {
  const calculation = await prisma.calculation.findFirst({
    where: { id: input.baseCalculationId, projectId },
    select: {
      id: true,
      version: true,
      currency: true,
      stages: {
        select: { id: true, name: true, role: true, hours: true, isApprovalTask: true },
        orderBy: { order: 'asc' },
      },
    },
  });
  if (!calculation) throw new ChangeRequestError('Базовый расчёт не найден в проекте', 400);

  const basePackage = input.basePackageId
    ? await loadBasePackage(projectId, input.basePackageId)
    : null;
  if (basePackage && basePackage.calculationId !== calculation.id) {
    throw new ChangeRequestError('Базовый комплект выпущен по другой версии расчёта', 400);
  }
  if (!basePackage && input.requirementIds.length > 0) {
    throw new ChangeRequestError('Затронутые требования выбираются из базового комплекта', 400);
  }

  const { requirements, unknownIds } = snapshotAffectedRequirements(
    basePackage?.snapshot ?? null,
    input.requirementIds,
  );
  if (unknownIds.length > 0) {
    throw new ChangeRequestError(
      `Требования не найдены в базовом комплекте: ${unknownIds.slice(0, 5).join(', ')}`,
      400,
    );
  }
  const knownIds = new Set(requirements.map((r) => r.id));
  for (const item of input.proposedChanges.items) {
    if (item.requirementId && !knownIds.has(item.requirementId)) {
      throw new ChangeRequestError(
        'Изменение ссылается на требование, не отмеченное как затронутое',
        400,
      );
    }
  }

  const impact = computeChangeImpact({
    calculation,
    stages: calculation.stages.filter((s) => !s.isApprovalTask),
    basePackage,
    requirementIds: requirements.map((r) => r.id),
  });

  return {
    title: input.title,
    initiator: input.initiator,
    reason: input.reason,
    baseCalculationId: calculation.id,
    basePackageId: basePackage?.id ?? null,
    affectedRequirements: requirements as unknown as Prisma.InputJsonValue,
    proposedChanges: input.proposedChanges as unknown as Prisma.InputJsonValue,
    impact: impact as unknown as Prisma.InputJsonValue,
  };
}

export async function listChangeRequests(projectId: string): Promise<ChangeRequestDto[]> {
  await requireProject(projectId);
  const rows = await prisma.changeRequest.findMany({
    where: { projectId },
    orderBy: { seq: 'desc' },
  });
  return rows.map((row) => toChangeRequestDto(row));
}

export async function getChangeRequest(projectId: string, crId: string): Promise<ChangeRequestDto> {
  const row = await prisma.changeRequest.findFirst({
    where: { id: crId, projectId },
    include: { events: { orderBy: { at: 'asc' } } },
  });
  if (!row) throw new ChangeRequestError('Запрос на изменение не найден', 404);
  return toChangeRequestDto(row);
}

function isUniqueViolation(error: unknown): boolean {
  // Дубликат (projectId, seq) при параллельном создании; код Prisma или PostgreSQL.
  const e = error as { code?: unknown; message?: unknown } | null;
  if (!e || typeof e !== 'object') return false;
  return e.code === 'P2002' || e.code === '23505' || String(e.message ?? '').includes('23505');
}

export async function createChangeRequest(
  projectId: string,
  input: ChangeRequestDraftInput,
  actor: string,
): Promise<ChangeRequestDto> {
  await requireProject(projectId);
  const data = await resolveDraft(projectId, input);
  // Номер — max+1 в проекте; параллельное создание ловит уникальный индекс.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const created = await prisma.$transaction(async (tx) => {
        const last = await tx.changeRequest.findFirst({
          where: { projectId },
          orderBy: { seq: 'desc' },
          select: { seq: true },
        });
        const row = await tx.changeRequest.create({
          data: { ...data, projectId, seq: (last?.seq ?? 0) + 1, createdBy: actor },
        });
        await tx.changeRequestEvent.create({
          data: { crId: row.id, action: 'created', actor },
        });
        return row;
      });
      return getChangeRequest(projectId, created.id);
    } catch (error) {
      if (!isUniqueViolation(error) || attempt === 2) throw error;
    }
  }
  throw new ChangeRequestError('Не удалось присвоить номер запросу', 409);
}

async function current(projectId: string, crId: string) {
  const row = await prisma.changeRequest.findFirst({
    where: { id: crId, projectId },
    select: { id: true, status: true, estimatedAt: true },
  });
  if (!row) throw new ChangeRequestError('Запрос на изменение не найден', 404);
  return { ...row, status: row.status as ChangeRequestStatus };
}

/**
 * Условное обновление: `status` в where защищает от гонки с параллельным
 * переходом — если запрос уже ушёл из ожидаемого состояния, ничего не пишется.
 */
async function guardedUpdate(
  projectId: string,
  crId: string,
  expected: ChangeRequestStatus,
  data: Prisma.ChangeRequestUpdateManyMutationInput,
  event: { action: ChangeRequestAction; actor: string; comment?: string | null; data?: unknown },
) {
  await prisma.$transaction(async (tx) => {
    const res = await tx.changeRequest.updateMany({
      where: { id: crId, projectId, status: expected },
      data,
    });
    if (res.count !== 1) {
      throw new ChangeRequestError(
        'Запрос уже изменён другим пользователем, обновите страницу',
        409,
      );
    }
    await tx.changeRequestEvent.create({
      data: {
        crId,
        action: event.action,
        actor: event.actor,
        comment: event.comment ?? null,
        ...(event.data === undefined ? {} : { data: event.data as Prisma.InputJsonValue }),
      },
    });
  });
  return getChangeRequest(projectId, crId);
}

export async function updateChangeRequestDraft(
  projectId: string,
  crId: string,
  input: ChangeRequestDraftInput,
  actor: string,
): Promise<ChangeRequestDto> {
  const cr = await current(projectId, crId);
  if (!canEditContent(cr.status)) {
    throw new ChangeRequestError('Править можно только черновик запроса', 409);
  }
  const data = await resolveDraft(projectId, input);
  return guardedUpdate(projectId, crId, 'draft', data, { action: 'updated', actor });
}

export async function submitChangeRequest(
  projectId: string,
  crId: string,
  actor: string,
  comment: string | null,
): Promise<ChangeRequestDto> {
  const cr = await current(projectId, crId);
  const error = transitionError(cr.status, 'submitted', { hasEstimate: !!cr.estimatedAt });
  if (error) throw new ChangeRequestError(error, 409);
  const full = await getChangeRequest(projectId, crId);
  if (
    full.affectedRequirements.length === 0 &&
    full.proposedChanges.items.length === 0 &&
    !full.proposedChanges.summary
  ) {
    throw new ChangeRequestError(
      'Укажите затронутые требования или опишите предлагаемое изменение',
      400,
    );
  }
  return guardedUpdate(
    projectId,
    crId,
    cr.status,
    { status: 'submitted' },
    { action: cr.status === 'deferred' ? 'reopened' : 'submitted', actor, comment },
  );
}

/**
 * Оценка специалиста: часы, стоимость и срок — ровно то, что он ввёл. Повторная
 * оценка заменяет значения в запросе, а прежние остаются в журнале.
 */
export async function recordEstimate(
  projectId: string,
  crId: string,
  estimate: ChangeEstimate,
  actor: string,
): Promise<ChangeRequestDto> {
  const cr = await current(projectId, crId);
  if (!canEstimate(cr.status)) {
    throw new ChangeRequestError('Оценку вносят только для запроса на оценке', 409);
  }
  return guardedUpdate(
    projectId,
    crId,
    'submitted',
    {
      confirmedHours: estimate.hours,
      confirmedCost: estimate.cost,
      confirmedScheduleDays: estimate.scheduleDays,
      estimateComment: estimate.comment,
      estimatedBy: actor,
      estimatedAt: new Date(),
    },
    {
      action: 'estimated',
      actor,
      comment: estimate.comment,
      data: { hours: estimate.hours, cost: estimate.cost, scheduleDays: estimate.scheduleDays },
    },
  );
}
