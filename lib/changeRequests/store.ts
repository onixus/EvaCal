import type { Prisma } from '../generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { safeJsonParse } from '@/lib/json';
import { lockCalculationLedger } from '@/lib/actualsLedgerData';
import { computeBaseFingerprint } from './apply';
import { chainHead } from './totals';
import { affectedRequirementIds } from '@/lib/acceptance/review';
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
  canSubmit,
  transitionError,
  type ChangeRequestDraftInput,
} from './workflow';

/** Отпечаток текущего состояния базы запроса; null — база удалена. */
export async function loadBaseFingerprint(
  db: Prisma.TransactionClient,
  cr: { baseCalculationId: string; basePackageId: string | null },
): Promise<string | null> {
  const calculation = await db.calculation.findUnique({
    where: { id: cr.baseCalculationId },
    select: {
      startDate: true,
      pmHours: true,
      currency: true,
      pricingMode: true,
      roleRates: true,
      overheadPercent: true,
      marginPercent: true,
      discountPercent: true,
      vatPercent: true,
      includeVat: true,
      stages: {
        select: {
          id: true,
          name: true,
          role: true,
          hours: true,
          order: true,
          isApprovalTask: true,
          requirements: true,
          parallel: true,
          approvalDays: true,
        },
      },
      risks: { select: { description: true, hours: true, order: true } },
      stageDependencies: {
        select: { fromStageId: true, toStageId: true, type: true, lagDays: true },
      },
    },
  });
  if (!calculation) return null;
  const basePackage = cr.basePackageId
    ? await db.gostPackage.findUnique({
        where: { id: cr.basePackageId },
        select: { snapshot: true, documentTypes: true },
      })
    : null;
  if (cr.basePackageId && !basePackage) return null;
  const { stageDependencies, ...rest } = calculation;
  return computeBaseFingerprint({
    calculation: { ...rest, dependencies: stageDependencies },
    basePackage,
  });
}

/**
 * Текущая голова цепочки изменений проекта — единственная допустимая база
 * нового запроса (см. `chainHead`). null — база ещё не определена.
 */
export async function loadChainHead(
  db: Prisma.TransactionClient,
  projectId: string,
): Promise<string | null> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { baselineCalculationId: true, wonCalculationId: true },
  });
  if (!project) return null;
  const accepted = await db.changeRequest.findMany({
    where: { projectId, status: 'accepted' },
    select: {
      id: true,
      seq: true,
      baseCalculationId: true,
      resultCalculationId: true,
      decidedAt: true,
    },
  });
  return chainHead(
    project.baselineCalculationId ?? project.wonCalculationId ?? null,
    accepted.map((cr) => ({ ...cr, decidedAt: cr.decidedAt ? cr.decidedAt.toISOString() : null })),
  );
}

/** База запроса — текущая голова цепочки, иначе изменения разошлись бы по веткам версий. */
export async function assertBaseIsHead(
  db: Prisma.TransactionClient,
  projectId: string,
  baseCalculationId: string,
  status: number,
): Promise<void> {
  const head = await loadChainHead(db, projectId);
  if (head && head !== baseCalculationId) {
    const headCalc = await db.calculation.findUnique({
      where: { id: head },
      select: { version: true },
    });
    throw new ChangeRequestError(
      `Базой может быть только текущая согласованная версия расчёта` +
        (headCalc ? ` (v${headCalc.version})` : '') +
        ': изменения оформляются цепочкой от первоначальной базы',
      status,
    );
  }
}

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
  /**
   * Только в карточке: оценка сделана по текущему состоянию базы. null — оценки
   * нет или запрос уже решён; false — база изменилась, нужна переоценка.
   */
  estimateMatchesBase?: boolean | null;
  /**
   * Только в карточке: проверки приёмки базового комплекта по затронутым
   * требованиям. Пока запрос на оценке или принят, приёмка помечает их «требует
   * пересмотра» (lib/acceptance/review.ts).
   */
  acceptanceChecks?: Array<{ id: string; requirementCode: string; title: string }>;
}

export type ChangeRequestRow = Prisma.ChangeRequestGetPayload<object>;
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
    select: {
      id: true,
      version: true,
      status: true,
      calculationId: true,
      documentTypes: true,
      snapshot: true,
    },
  });
  if (!pkg) throw new ChangeRequestError('Базовый комплект не найден в проекте', 400);
  // Черновик комплекта мастер перезаписывает при каждом сохранении — базой
  // договора он быть не может.
  if (pkg.status === 'draft') {
    throw new ChangeRequestError('Базой может быть только выпущенный комплект, не черновик', 400);
  }
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
        select: {
          id: true,
          name: true,
          role: true,
          hours: true,
          order: true,
          requirements: true,
          isApprovalTask: true,
        },
        orderBy: { order: 'asc' },
      },
    },
  });
  if (!calculation) throw new ChangeRequestError('Базовый расчёт не найден в проекте', 400);
  await assertBaseIsHead(prisma, projectId, calculation.id, 400);

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
    // Все этапы, как их получает генератор комплекта: трассировка совпадает с выпущенной.
    stages: calculation.stages,
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
  const dto = toChangeRequestDto(row);
  if (row.estimatedAt && (row.status === 'submitted' || row.status === 'deferred')) {
    const hash = await loadBaseFingerprint(prisma, row);
    dto.estimateMatchesBase = !!hash && hash === row.estimateBaseHash;
  } else {
    dto.estimateMatchesBase = null;
  }
  const requirementIds = affectedRequirementIds(row);
  dto.acceptanceChecks =
    row.basePackageId && requirementIds.length
      ? await prisma.acceptanceCheck.findMany({
          where: { packageId: row.basePackageId, requirementId: { in: requirementIds } },
          select: { id: true, requirementCode: true, title: true },
          orderBy: { order: 'asc' },
        })
      : [];
  return dto;
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
  // Номер — max+1 в проекте; параллельное создание ловит уникальный индекс и
  // повторяет попытку, а исчерпав попытки, отвечает 409, а не 500.
  const attempts = 5;
  for (let attempt = 0; attempt < attempts; attempt++) {
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
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw new ChangeRequestError(
    'Не удалось присвоить номер запросу: параллельное создание, повторите',
    409,
  );
}

async function current(projectId: string, crId: string) {
  const row = await prisma.changeRequest.findFirst({
    where: { id: crId, projectId },
    select: {
      id: true,
      status: true,
      estimatedAt: true,
      baseCalculationId: true,
      basePackageId: true,
    },
  });
  if (!row) throw new ChangeRequestError('Запрос на изменение не найден', 404);
  return { ...row, status: row.status as ChangeRequestStatus };
}

interface GuardOptions {
  /** Оптимистическая блокировка: правка только той версии, которую видел автор. */
  expectedUpdatedAt?: Date;
  /** Проверка строки после обновления в той же транзакции; ошибка откатывает всё. */
  validate?: (row: ChangeRequestRow) => void;
}

/**
 * Условное обновление: `status` (и, для правки, `updatedAt`) в where защищает
 * от гонки с параллельным переходом или правкой — если запрос уже изменился,
 * ничего не пишется и возвращается 409.
 */
export async function guardedUpdate(
  projectId: string,
  crId: string,
  expected: ChangeRequestStatus,
  data: Prisma.ChangeRequestUpdateManyMutationInput,
  event: { action: ChangeRequestAction; actor: string; comment?: string | null; data?: unknown },
  options: GuardOptions = {},
) {
  await prisma.$transaction(async (tx) => {
    const res = await tx.changeRequest.updateMany({
      where: {
        id: crId,
        projectId,
        status: expected,
        ...(options.expectedUpdatedAt ? { updatedAt: options.expectedUpdatedAt } : {}),
      },
      data,
    });
    if (res.count !== 1) {
      throw new ChangeRequestError(
        'Запрос уже изменён другим пользователем, обновите страницу',
        409,
      );
    }
    if (options.validate) {
      const row = await tx.changeRequest.findFirst({ where: { id: crId, projectId } });
      if (row) options.validate(row);
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
  expectedUpdatedAt: Date,
): Promise<ChangeRequestDto> {
  const cr = await current(projectId, crId);
  if (!canEditContent(cr.status)) {
    throw new ChangeRequestError('Править можно только черновик запроса', 409);
  }
  const data = await resolveDraft(projectId, input);
  return guardedUpdate(
    projectId,
    crId,
    'draft',
    data,
    { action: 'updated', actor },
    { expectedUpdatedAt },
  );
}

function assertHasContent(row: ChangeRequestRow) {
  const dto = toChangeRequestDto(row);
  if (
    dto.affectedRequirements.length === 0 &&
    dto.proposedChanges.items.length === 0 &&
    !dto.proposedChanges.summary
  ) {
    throw new ChangeRequestError(
      'Укажите затронутые требования или опишите предлагаемое изменение',
      400,
    );
  }
}

export async function submitChangeRequest(
  projectId: string,
  crId: string,
  actor: string,
  comment: string | null,
): Promise<ChangeRequestDto> {
  const cr = await current(projectId, crId);
  // Отложенный запрос возвращают решением reopen (архитектор/админ), не передачей.
  const error = canSubmit(cr.status)
    ? transitionError(cr.status, 'submitted', { hasEstimate: !!cr.estimatedAt })
    : 'Передать на оценку можно только черновик';
  if (error) throw new ChangeRequestError(error, 409);
  await assertBaseIsHead(prisma, projectId, cr.baseCalculationId, 409);
  // Непустоту проверяем внутри той же транзакции, что и переход: правка
  // черновика между проверкой и переходом не проскочит.
  return guardedUpdate(
    projectId,
    crId,
    cr.status,
    { status: 'submitted' },
    { action: 'submitted', actor, comment },
    { validate: assertHasContent },
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
  // Оценка привязывается к состоянию базы: отпечаток считается в той же
  // транзакции и под той же блокировкой расчёта, что и перестроение этапов
  // (lockCalculationLedger), — правка базы не проскочит между чтением и записью.
  await prisma.$transaction(async (tx) => {
    await lockCalculationLedger(tx, cr.baseCalculationId);
    const baseHash = await loadBaseFingerprint(tx, cr);
    if (!baseHash) throw new ChangeRequestError('Базовый расчёт или комплект удалён', 409);
    const res = await tx.changeRequest.updateMany({
      where: { id: crId, projectId, status: 'submitted' },
      data: {
        confirmedHours: estimate.hours,
        confirmedCost: estimate.cost,
        confirmedScheduleDays: estimate.scheduleDays,
        estimateComment: estimate.comment,
        estimatedBy: actor,
        estimatedAt: new Date(),
        estimateBaseHash: baseHash,
      },
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
        action: 'estimated',
        actor,
        comment: estimate.comment,
        data: { hours: estimate.hours, cost: estimate.cost, scheduleDays: estimate.scheduleDays },
      },
    });
  });
  return getChangeRequest(projectId, crId);
}
