import type { Prisma } from '../generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { safeJsonParse } from '@/lib/json';
import { recordInternalChangeTx } from '@/lib/changelog';
import { createCalculationVersion, createDraftPackageVersion } from '@/lib/project';
import { applyProposedChanges, matchStageIds } from './apply';
import { lockCalculationLedger } from '@/lib/actualsLedgerData';
import {
  assertBaseIsHead,
  getChangeRequest,
  isUsableBasePackageStatus,
  loadBaseFingerprint,
  toChangeRequestDto,
  type ChangeRequestDto,
} from './store';
import type { ChangeRequestStatus } from './types';
import {
  ChangeRequestError,
  DECISION_TARGETS,
  decisionError,
  estimateOnReopen,
  formatChangeLabel,
  formatChangeRequestNumber,
  type ChangeRequestDecision,
} from './workflow';

/**
 * Решения по запросам на изменение (#103 §1.3–1.4, WP-2b).
 *
 * - reject/defer — только статус, автор решения и запись в журнале.
 * - reopen — отложенный снова на оценке; решение очищается, оценка остаётся,
 *   только если база не менялась с момента оценки.
 * - accept — одна транзакция: новая версия расчёта от базы + риск «ИЗМ-NN» с
 *   подтверждёнными часами, черновая версия комплекта с правками требований,
 *   строка ЛВИ, ссылки result*Id и первоначальная база проекта. Любая ошибка
 *   откатывает всё; базовые расчёт, этапы и комплект не меняются.
 */

type Tx = Prisma.TransactionClient;

/** Сериализует решения по проекту: проверка «база уже изменена» без гонки. */
async function lockProject(tx: Tx, projectId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`change-requests:${projectId}`}))`;
}

async function loadForDecision(tx: Tx, projectId: string, crId: string) {
  const cr = await tx.changeRequest.findFirst({ where: { id: crId, projectId } });
  if (!cr) throw new ChangeRequestError('Запрос на изменение не найден', 404);
  return { ...cr, status: cr.status as ChangeRequestStatus };
}

async function conditionalUpdate(
  tx: Tx,
  cr: { id: string; projectId: string; status: string; updatedAt: Date },
  data: Prisma.ChangeRequestUpdateManyMutationInput,
) {
  const res = await tx.changeRequest.updateMany({
    where: { id: cr.id, projectId: cr.projectId, status: cr.status, updatedAt: cr.updatedAt },
    data,
  });
  if (res.count !== 1) {
    throw new ChangeRequestError('Запрос уже изменён другим пользователем, обновите страницу', 409);
  }
}

export interface DecisionInput {
  decision: ChangeRequestDecision;
  actor: string;
  role: string;
  comment: string | null;
}

export async function decideChangeRequest(
  projectId: string,
  crId: string,
  input: DecisionInput,
): Promise<ChangeRequestDto> {
  if (input.decision === 'accept') return acceptChangeRequest(projectId, crId, input);
  await prisma.$transaction(async (tx) => {
    await lockProject(tx, projectId);
    const cr = await loadForDecision(tx, projectId, crId);
    await lockCalculationLedger(tx, cr.baseCalculationId);
    const hash = cr.estimatedAt ? await loadBaseFingerprint(tx, cr) : null;
    const matches = !!hash && hash === cr.estimateBaseHash;
    const error = decisionError(input.decision, cr.status, {
      hasEstimate: !!cr.estimatedAt,
      estimateMatchesBase: matches,
    });
    if (error) throw new ChangeRequestError(error, 409);

    if (input.decision === 'reopen') {
      const policy = estimateOnReopen(!!cr.estimatedAt, matches);
      await conditionalUpdate(tx, cr, {
        status: 'submitted',
        decidedBy: null,
        decidedAt: null,
        ...(policy === 'clear'
          ? {
              confirmedHours: null,
              confirmedCost: null,
              confirmedScheduleDays: null,
              estimateComment: null,
              estimatedBy: null,
              estimatedAt: null,
              estimateBaseHash: null,
            }
          : {}),
      });
      await tx.changeRequestEvent.create({
        data: {
          crId,
          action: 'reopened',
          actor: input.actor,
          comment: input.comment,
          data: { estimate: policy === 'clear' ? 'cleared' : policy === 'keep' ? 'kept' : 'none' },
        },
      });
      return;
    }

    await conditionalUpdate(tx, cr, {
      status: DECISION_TARGETS[input.decision],
      decidedBy: input.actor,
      decidedAt: new Date(),
    });
    await tx.changeRequestEvent.create({
      data: {
        crId,
        action: DECISION_TARGETS[input.decision],
        actor: input.actor,
        comment: input.comment,
      },
    });
  });
  return getChangeRequest(projectId, crId);
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

async function acceptChangeRequest(
  projectId: string,
  crId: string,
  input: DecisionInput,
): Promise<ChangeRequestDto> {
  await prisma.$transaction(
    async (tx) => {
      await lockProject(tx, projectId);
      const cr = await loadForDecision(tx, projectId, crId);
      // Та же блокировка расчёта, что у перестроения этапов: база не меняется
      // между сверкой отпечатка и созданием версии.
      await lockCalculationLedger(tx, cr.baseCalculationId);
      const hash = cr.estimatedAt ? await loadBaseFingerprint(tx, cr) : null;
      if (cr.estimatedAt && !hash) {
        throw new ChangeRequestError('Базовый расчёт или комплект удалён', 409);
      }
      const error = decisionError('accept', cr.status, {
        hasEstimate: !!cr.estimatedAt,
        estimateMatchesBase: !!hash && hash === cr.estimateBaseHash,
      });
      if (error) throw new ChangeRequestError(error, 409);

      // Одна база — одно принятое изменение: следующий запрос оформляется на
      // версии, созданной предыдущим, иначе ветки версий разойдутся.
      const sibling = await tx.changeRequest.findFirst({
        where: {
          projectId,
          baseCalculationId: cr.baseCalculationId,
          status: 'accepted',
          id: { not: cr.id },
        },
        select: { seq: true },
      });
      if (sibling) {
        throw new ChangeRequestError(
          `Базовая версия уже изменена запросом ${formatChangeRequestNumber(sibling.seq)} — ` +
            'оформите запрос на версии, созданной им',
          409,
        );
      }
      await assertBaseIsHead(tx, projectId, cr.baseCalculationId, 409);

      const dto = toChangeRequestDto(cr);
      const number = formatChangeRequestNumber(cr.seq);
      const label = formatChangeLabel(cr.seq);
      const hours = cr.confirmedHours ?? 0;
      const days = cr.confirmedScheduleDays ?? 0;
      const cost = dto.confirmedCost ?? '0.00';

      const base = await tx.calculation.findUnique({
        where: { id: cr.baseCalculationId },
        select: {
          currency: true,
          stages: {
            select: { id: true, name: true, role: true, order: true, isApprovalTask: true },
          },
        },
      });
      if (!base) throw new ChangeRequestError('Базовый расчёт удалён', 409);

      const version = await createCalculationVersion(
        {
          parentCalculationId: cr.baseCalculationId,
          versionComment: `${label} по ${number}: ${cr.title}`,
          createdBy: input.actor,
        },
        tx,
      );
      if (!version) throw new ChangeRequestError('Не удалось создать версию расчёта', 500);

      // Изменение — отдельная явная строка с подтверждёнными часами, а не
      // доначисление часов связанным этапам.
      await tx.risk.create({
        data: {
          calculationId: version.id,
          description:
            `${label} (${number}): ${cr.title}. Оценка специалиста: ${signed(hours)} ч, ` +
            `${cost} ${base.currency} без НДС, срок ${signed(days)} раб. дн.`,
          hours,
          order: version.risks.reduce((m, r) => Math.max(m, r.order), -1) + 1,
        },
      });

      let resultPackage: { id: string; version: number } | null = null;
      let appliedSummary = '';
      if (cr.basePackageId) {
        const basePkg = await tx.gostPackage.findUnique({ where: { id: cr.basePackageId } });
        if (!basePkg) throw new ChangeRequestError('Базовый комплект удалён', 409);
        if (!isUsableBasePackageStatus(basePkg.status)) {
          throw new ChangeRequestError(
            'Базовый комплект — черновик или архивный, принять нельзя',
            409,
          );
        }
        const applied = applyProposedChanges(
          safeJsonParse<unknown>(basePkg.snapshot ?? null, {}),
          dto.proposedChanges,
          label,
          matchStageIds(base.stages, version.stages),
        );
        appliedSummary =
          `; требования: изменено ${applied.modified}, исключено ${applied.removed}, ` +
          `добавлено ${applied.added}`;
        const pkg = await createDraftPackageVersion(tx, {
          projectId,
          calculationId: version.id,
          name: `${basePkg.name} · ${label}`,
          standardProfileId: basePkg.standardProfileId,
          standardProfileVersion: basePkg.standardProfileVersion,
          generatorVersion: basePkg.generatorVersion,
          documentTypes: safeJsonParse<string[]>(basePkg.documentTypes, ['tz']),
          metadata: basePkg.metadata,
          snapshot: applied.snapshot,
          createdBy: input.actor,
        });
        resultPackage = { id: pkg.id, version: pkg.version };
      }

      await recordInternalChangeTx(tx, {
        calculationId: version.id,
        author: input.actor,
        role: input.role,
        docRef: `Запрос на изменение · ${number}`,
        text:
          `Принят ${number} «${cr.title}»: ${signed(hours)} ч, ${cost} ${base.currency}, ` +
          `срок ${signed(days)} раб. дн.${appliedSummary}`,
        source: 'change_request',
        packageId: resultPackage?.id ?? null,
      });

      await conditionalUpdate(tx, cr, {
        status: 'accepted',
        decidedBy: input.actor,
        decidedAt: new Date(),
        resultCalculationId: version.id,
        resultPackageId: resultPackage?.id ?? null,
      });
      await tx.changeRequestEvent.create({
        data: {
          crId,
          action: 'accepted',
          actor: input.actor,
          comment: input.comment,
          data: {
            resultCalculationId: version.id,
            resultCalculationVersion: version.version,
            resultPackageId: resultPackage?.id ?? null,
            resultPackageVersion: resultPackage?.version ?? null,
          },
        },
      });

      // Первоначальная база фиксируется при первом принятом изменении.
      const project = await tx.project.findUnique({
        where: { id: projectId },
        select: { wonCalculationId: true },
      });
      await tx.project.updateMany({
        where: { id: projectId, baselineCalculationId: null },
        data: { baselineCalculationId: project?.wonCalculationId ?? cr.baseCalculationId },
      });
    },
    { timeout: 30000, maxWait: 10000 },
  );
  return getChangeRequest(projectId, crId);
}

/**
 * Статусы, в которых запрос держит свою базу и результат: на оценке, отложен,
 * принят. Черновик и отклонённый — нет: при удалении расчёта они удаляются
 * вместе с ним (то же делают триггеры БД).
 */
export const ACTIVE_CHANGE_REQUEST_STATUSES = ['submitted', 'deferred', 'accepted'] as const;

/** Активные запросы, для которых расчёт (или его комплекты) — база или результат. */
export async function changeRequestsReferencingCalculation(calculationId: string) {
  const packages = await prisma.gostPackage.findMany({
    where: { calculationId },
    select: { id: true },
  });
  const packageIds = packages.map((p) => p.id);
  return prisma.changeRequest.findMany({
    where: {
      status: { in: [...ACTIVE_CHANGE_REQUEST_STATUSES] },
      OR: [
        { baseCalculationId: calculationId },
        { resultCalculationId: calculationId },
        ...(packageIds.length
          ? [{ basePackageId: { in: packageIds } }, { resultPackageId: { in: packageIds } }]
          : []),
      ],
    },
    select: { seq: true, projectId: true },
  });
}

/**
 * Отказ триггера защиты базы (ERRCODE restrict_violation, 23001). Prisma
 * пробрасывает его по-разному в зависимости от драйвера, поэтому смотрим и код,
 * и текст.
 */
export function isChangeRequestRestrictViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: unknown; message?: unknown; meta?: unknown; cause?: unknown };
  const text = `${String(e.code ?? '')} ${String(e.message ?? '')} ${JSON.stringify(e.meta ?? {})}`;
  return (
    text.includes('23001') ||
    text.includes('restrict_violation') ||
    text.includes('referenced by a change request') ||
    (e.cause !== undefined && e.cause !== error && isChangeRequestRestrictViolation(e.cause))
  );
}

/** Удаление черновика запроса (с журналом). Другие статусы — история согласования. */
export async function deleteDraftChangeRequest(projectId: string, crId: string): Promise<void> {
  const res = await prisma.changeRequest.deleteMany({
    where: { id: crId, projectId, status: 'draft' },
  });
  if (res.count !== 1) {
    const exists = await prisma.changeRequest.findFirst({
      where: { id: crId, projectId },
      select: { id: true },
    });
    throw new ChangeRequestError(
      exists ? 'Удалить можно только черновик запроса' : 'Запрос на изменение не найден',
      exists ? 409 : 404,
    );
  }
}
