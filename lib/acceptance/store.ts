/**
 * Хранилище проверок приёмки (#103 WP-4a).
 *
 * Проверки засеваются из снимка утверждённой редакции комплекта и привязаны
 * к ней навсегда: новая редакция получает свои проверки, история старой не
 * переписывается. Результаты только дописываются (UPDATE запрещён триггером в
 * БД), текущее состояние вычисляется по последнему результату.
 */
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { parsePackageSnapshot } from '@/lib/gost34/diff';
import { deleteAcceptanceEvidence, storeAcceptanceEvidence } from '@/lib/gost34/storage';
import {
  canDeleteEvidence,
  canEditRemark,
  checkRemarkTransition,
  currentStatus,
  evidenceKeyPrefix,
  extractCheckSeeds,
  ORPHAN_EVIDENCE_TTL_MS,
  sanitizeEvidenceName,
  sortResultsNewestFirst,
  summarizeChecks,
  type AcceptanceStatus,
  type EvidenceRef,
  type NormalizedResult,
  type RemarkAction,
  type RemarkStatus,
  type RuleResult,
} from './rules';
import type { SerializedCheck, SerializedRemark, SerializedResult } from './types';
import { REVIEW_TRIGGER_STATUSES, reviewFlagsByRequirement, type ReviewFlag } from './review';
import type { VerificationMethod } from '@/lib/gost34/requirements/v2';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

interface ResultRow {
  id: string;
  checkId: string;
  status: string;
  executorName: string | null;
  executorId: string | null;
  executedAt: Date | null;
  actualResult: string | null;
  evidence: unknown;
  recordedBy: string;
  createdAt: Date;
}

interface RemarkRow {
  id: string;
  checkId: string;
  resultId: string | null;
  text: string;
  status: string;
  retestResultId: string | null;
  createdBy: string;
  createdAt: Date;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  verifiedBy: string | null;
  verifiedAt: Date | null;
  edits?: {
    id: string;
    previousText: string;
    newText: string;
    editedBy: string;
    editedAt: Date;
  }[];
}

const REMARK_INCLUDE = { edits: { orderBy: { editedAt: 'asc' as const } } };

interface CheckRow {
  id: string;
  packageId: string;
  requirementId: string;
  requirementCode: string;
  title: string;
  method: string | null;
  criteria: string[];
  order: number;
  results: ResultRow[];
  remarks: RemarkRow[];
}

export function serializeResult(row: ResultRow): SerializedResult {
  return {
    id: row.id,
    checkId: row.checkId,
    status: row.status as AcceptanceStatus,
    executorName: row.executorName,
    executorId: row.executorId,
    executedAt: iso(row.executedAt),
    actualResult: row.actualResult,
    evidence: Array.isArray(row.evidence) ? (row.evidence as EvidenceRef[]) : [],
    recordedBy: row.recordedBy,
    createdAt: row.createdAt.toISOString(),
  };
}

export function serializeRemark(row: RemarkRow): SerializedRemark {
  return {
    id: row.id,
    checkId: row.checkId,
    resultId: row.resultId,
    text: row.text,
    status: row.status as RemarkStatus,
    retestResultId: row.retestResultId,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    resolvedBy: row.resolvedBy,
    resolvedAt: iso(row.resolvedAt),
    verifiedBy: row.verifiedBy,
    verifiedAt: iso(row.verifiedAt),
    edits: (row.edits ?? []).map((e) => ({
      id: e.id,
      previousText: e.previousText,
      newText: e.newText,
      editedBy: e.editedBy,
      editedAt: e.editedAt.toISOString(),
    })),
  };
}

export function serializeCheck(row: CheckRow): SerializedCheck {
  const history = sortResultsNewestFirst(row.results).map(serializeResult);
  const remarks = [...row.remarks]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map(serializeRemark);
  return {
    id: row.id,
    packageId: row.packageId,
    requirementId: row.requirementId,
    requirementCode: row.requirementCode,
    title: row.title,
    method: (row.method as VerificationMethod | null) ?? null,
    criteria: row.criteria ?? [],
    order: row.order,
    status: currentStatus(row.results),
    latest: history[0] ?? null,
    history,
    remarks,
    openRemarks: remarks.filter((r) => r.status !== 'verified').length,
    needsReview: [],
  };
}

const CHECK_INCLUDE = { results: true, remarks: { include: REMARK_INCLUDE } } as const;

/** Проверки редакции комплекта с полной историей результатов и замечаний. */
export async function listChecks(
  packageId: string,
  flags?: Map<string, ReviewFlag[]>,
): Promise<SerializedCheck[]> {
  const rows = (await prisma.acceptanceCheck.findMany({
    where: { packageId },
    orderBy: [{ order: 'asc' }, { id: 'asc' }],
    include: CHECK_INCLUDE,
  })) as CheckRow[];
  return rows.map((row) => ({
    ...serializeCheck(row),
    needsReview: flags?.get(row.requirementId) ?? [],
  }));
}

/**
 * Пометки «требует пересмотра» для проверок редакции: запросы на изменение
 * проекта в состоянии «на оценке» или «принят», нацеленные на эту редакцию.
 */
export async function loadReviewFlags(pkg: {
  id: string;
  calculationId: string;
  projectId: string | null;
}): Promise<Map<string, ReviewFlag[]>> {
  if (!pkg.projectId) return new Map();
  const crs = await prisma.changeRequest.findMany({
    where: { projectId: pkg.projectId, status: { in: [...REVIEW_TRIGGER_STATUSES] } },
    select: {
      id: true,
      seq: true,
      title: true,
      status: true,
      basePackageId: true,
      baseCalculationId: true,
      resultPackageId: true,
      affectedRequirements: true,
      proposedChanges: true,
    },
  });
  return reviewFlagsByRequirement(pkg, crs);
}

/** Проверки редакции вместе с пометками пересмотра. */
export async function listChecksWithFlags(pkg: {
  id: string;
  calculationId: string;
  projectId: string | null;
}): Promise<SerializedCheck[]> {
  return listChecks(pkg.id, await loadReviewFlags(pkg));
}

export async function loadCheck(
  packageId: string,
  checkId: string,
): Promise<SerializedCheck | null> {
  const row = (await prisma.acceptanceCheck.findFirst({
    where: { id: checkId, packageId },
    include: CHECK_INCLUDE,
  })) as CheckRow | null;
  return row ? serializeCheck(row) : null;
}

export function summarize(checks: SerializedCheck[]) {
  return summarizeChecks(checks);
}

interface SeedPackage {
  id: string;
  calculationId: string;
  snapshot: string | null;
}

/** Сколько требований снимка ещё не стали проверками. */
export async function countPendingSeeds(pkg: SeedPackage): Promise<number> {
  const seeds = extractCheckSeeds(parsePackageSnapshot(pkg as never));
  if (seeds.length === 0) return 0;
  const existing = await prisma.acceptanceCheck.findMany({
    where: { packageId: pkg.id },
    select: { requirementId: true },
  });
  const have = new Set(existing.map((e) => e.requirementId));
  return seeds.filter((s) => !have.has(s.requirementId)).length;
}

/**
 * Засев проверок из снимка комплекта. Идемпотентен: уникальный ключ
 * (packageId, requirementId) не даст завести дубль ни повторным вызовом, ни
 * гонкой двух запросов. Уже заведённые проверки не меняются.
 */
export async function seedChecks(
  pkg: SeedPackage,
  createdBy: string,
): Promise<{ created: number; total: number }> {
  const seeds = extractCheckSeeds(parsePackageSnapshot(pkg as never));
  if (seeds.length > 0) {
    const existingCount = await prisma.acceptanceCheck.count({ where: { packageId: pkg.id } });
    const res = await prisma.acceptanceCheck.createMany({
      data: seeds.map((s) => ({
        packageId: pkg.id,
        calculationId: pkg.calculationId,
        requirementId: s.requirementId,
        requirementCode: s.requirementCode,
        title: s.title,
        method: s.method,
        criteria: s.criteria,
        order: existingCount + s.order,
        createdBy,
      })),
      skipDuplicates: true,
    });
    const total = await prisma.acceptanceCheck.count({ where: { packageId: pkg.id } });
    return { created: res.count, total };
  }
  return {
    created: 0,
    total: await prisma.acceptanceCheck.count({ where: { packageId: pkg.id } }),
  };
}

interface EvidenceRow {
  id: string;
  key: string;
  name: string;
  size: number;
  mime: string;
  checksum: string;
  uploadedBy: string;
  uploadedById: string;
  uploadedAt: Date;
  resultId: string | null;
}

export function serializeEvidence(row: EvidenceRow): EvidenceRef {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    size: row.size,
    mime: row.mime,
    checksum: row.checksum,
    uploadedBy: row.uploadedBy,
    uploadedAt: row.uploadedAt.toISOString(),
  };
}

/**
 * Удаляет неприкреплённые вложения проверки старше `ORPHAN_EVIDENCE_TTL_MS`:
 * загрузку начали, а результат так и не записали. Сбой удаления файла не
 * мешает основной операции — строка остаётся, попытка повторится.
 */
export async function cleanupOrphanEvidence(checkId: string, now = new Date()): Promise<number> {
  const stale = await prisma.acceptanceEvidence.findMany({
    where: {
      checkId,
      resultId: null,
      uploadedAt: { lt: new Date(now.getTime() - ORPHAN_EVIDENCE_TTL_MS) },
    },
    select: { id: true, key: true },
  });
  let removed = 0;
  for (const row of stale) {
    try {
      const res = await prisma.acceptanceEvidence.deleteMany({
        where: { id: row.id, resultId: null },
      });
      if (res.count > 0) await deleteAcceptanceEvidence(row.key);
      removed += res.count;
    } catch (err) {
      console.warn(`[acceptance] не удалось удалить вложение ${row.key}:`, err);
    }
  }
  return removed;
}

/**
 * Сохраняет вложение проверки. Ключ, имя, загрузчика и время фиксирует
 * сервер: клиент потом ссылается на вложение только по идентификатору.
 */
export async function uploadEvidence(input: {
  packageId: string;
  checkId: string;
  fileName: string;
  ext: string;
  mime: string;
  buffer: Buffer;
  uploadedBy: string;
  uploadedById: string;
}): Promise<EvidenceRef> {
  await cleanupOrphanEvidence(input.checkId);
  const key = `${evidenceKeyPrefix(input.packageId, input.checkId)}${randomUUID()}.${input.ext}`;
  const stored = await storeAcceptanceEvidence(key, input.buffer);
  try {
    const row = await prisma.acceptanceEvidence.create({
      data: {
        checkId: input.checkId,
        key: stored.artifactPath,
        name: sanitizeEvidenceName(input.fileName, input.ext),
        size: stored.sizeBytes,
        mime: input.mime,
        checksum: stored.checksum,
        uploadedBy: input.uploadedBy,
        uploadedById: input.uploadedById,
      },
    });
    return serializeEvidence(row);
  } catch (err) {
    await deleteAcceptanceEvidence(stored.artifactPath).catch(() => undefined);
    throw err;
  }
}

/** Удалить неприкреплённое вложение (загрузчик или администратор). */
export async function deleteEvidence(input: {
  checkId: string;
  evidenceId: string;
  actor: { id: string; role: string | null };
}): Promise<RuleResult<EvidenceRef>> {
  const row = await prisma.acceptanceEvidence.findFirst({
    where: { id: input.evidenceId, checkId: input.checkId },
  });
  if (!row) return { ok: false, status: 404, error: 'Вложение не найдено' };
  const rule = canDeleteEvidence(input.actor, row);
  if (!rule.ok) return rule;
  // Условие resultId = null защищает от гонки с записью результата.
  const res = await prisma.acceptanceEvidence.deleteMany({
    where: { id: row.id, resultId: null },
  });
  if (res.count === 0) {
    return { ok: false, status: 409, error: 'Вложение уже прикреплено к результату' };
  }
  await deleteAcceptanceEvidence(row.key).catch((err) =>
    console.warn(`[acceptance] файл вложения ${row.key} не удалён:`, err),
  );
  return { ok: true, value: serializeEvidence(row) };
}

/** Прикреплённое к результату вложение проверки по ключу (для скачивания). */
export async function findEvidence(checkId: string, key: string): Promise<EvidenceRef | null> {
  const row = await prisma.acceptanceEvidence.findFirst({
    where: { checkId, key, resultId: { not: null } },
  });
  return row ? serializeEvidence(row) : null;
}

class EvidenceConflict extends Error {}

/**
 * Записывает результат (новая строка, старые не трогаются) и прикрепляет к
 * нему вложения. Прикрепить можно только неприкреплённые вложения этой
 * проверки; при гонке транзакция откатывается целиком. Если передан текст
 * замечания, оно создаётся в той же транзакции и ссылается на результат.
 */
export async function recordResult(input: {
  checkId: string;
  result: NormalizedResult;
  executorId: string | null;
  evidenceIds: string[];
  recordedBy: string;
  recordedById: string;
  remarkText?: string | null;
}): Promise<RuleResult<{ result: SerializedResult; remark: SerializedRemark | null }>> {
  try {
    const value = await prisma.$transaction(async (tx) => {
      const evidence = input.evidenceIds.length
        ? await tx.acceptanceEvidence.findMany({
            where: { id: { in: input.evidenceIds }, checkId: input.checkId, resultId: null },
          })
        : [];
      if (evidence.length !== input.evidenceIds.length) throw new EvidenceConflict();
      const ordered = input.evidenceIds.map((id) => evidence.find((e) => e.id === id)!);
      const row = await tx.acceptanceResult.create({
        data: {
          checkId: input.checkId,
          status: input.result.status,
          executorName: input.result.executorName,
          executorId: input.executorId,
          executedAt: input.result.executedAt,
          actualResult: input.result.actualResult,
          evidence: ordered.map(serializeEvidence) as never,
          recordedBy: input.recordedBy,
        },
      });
      if (ordered.length) {
        const attached = await tx.acceptanceEvidence.updateMany({
          where: { id: { in: input.evidenceIds }, resultId: null },
          data: { resultId: row.id },
        });
        if (attached.count !== ordered.length) throw new EvidenceConflict();
      }
      const remark = input.remarkText
        ? await tx.acceptanceRemark.create({
            data: {
              checkId: input.checkId,
              resultId: row.id,
              text: input.remarkText,
              createdBy: input.recordedBy,
              createdById: input.recordedById,
            },
            include: REMARK_INCLUDE,
          })
        : null;
      return {
        result: serializeResult(row),
        remark: remark ? serializeRemark(remark) : null,
      };
    });
    return { ok: true, value };
  } catch (err) {
    if (err instanceof EvidenceConflict) {
      return {
        ok: false,
        status: 400,
        error: 'Вложение не найдено, относится к другой проверке или уже прикреплено',
      };
    }
    throw err;
  }
}

export async function createRemark(input: {
  checkId: string;
  resultId: string | null;
  text: string;
  createdBy: string;
  createdById: string;
}): Promise<SerializedRemark> {
  return serializeRemark(
    await prisma.acceptanceRemark.create({ data: input, include: REMARK_INCLUDE }),
  );
}

/**
 * Переход замечания по жизненному циклу. Состояние сверяется в условии
 * `updateMany`, поэтому два одновременных перехода не проскочат оба.
 */
export async function transitionRemark(input: {
  checkId: string;
  remarkId: string;
  action: RemarkAction;
  retestResultId?: string | null;
  actor: string;
}): Promise<RuleResult<SerializedRemark>> {
  const remark = await prisma.acceptanceRemark.findFirst({
    where: { id: input.remarkId, checkId: input.checkId },
  });
  if (!remark) return { ok: false, status: 404, error: 'Замечание не найдено' };
  const retest = input.retestResultId
    ? await prisma.acceptanceResult.findUnique({ where: { id: input.retestResultId } })
    : null;
  if (input.retestResultId && !retest) {
    return { ok: false, status: 400, error: 'Повторная проверка не найдена' };
  }
  const rule = checkRemarkTransition(remark, input.action, retest, input.checkId);
  if (!rule.ok) return rule;
  const now = new Date();
  const next = rule.value;
  const data =
    next === 'resolved'
      ? { status: next, resolvedBy: input.actor, resolvedAt: now }
      : next === 'open'
        ? { status: next, resolvedBy: null, resolvedAt: null }
        : {
            status: next,
            verifiedBy: input.actor,
            verifiedAt: now,
            retestResultId: retest!.id,
          };
  const updated = await prisma.acceptanceRemark.updateMany({
    where: { id: remark.id, status: remark.status },
    data,
  });
  if (updated.count === 0) {
    return { ok: false, status: 409, error: 'Замечание уже изменено другим пользователем' };
  }
  const row = await prisma.acceptanceRemark.findUniqueOrThrow({
    where: { id: remark.id },
    include: REMARK_INCLUDE,
  });
  return { ok: true, value: serializeRemark(row) };
}

/**
 * Правка текста открытого замечания автором или администратором. Прежний
 * текст сохраняется в журнале правок в той же транзакции; условие на текст и
 * статус в `updateMany` не даёт одновременной правке потерять историю.
 */
export async function editRemarkText(input: {
  checkId: string;
  remarkId: string;
  text: string;
  actor: { id: string; name: string; role: string | null };
}): Promise<RuleResult<{ remark: SerializedRemark; previousText: string }>> {
  const remark = await prisma.acceptanceRemark.findFirst({
    where: { id: input.remarkId, checkId: input.checkId },
  });
  if (!remark) return { ok: false, status: 404, error: 'Замечание не найдено' };
  const rule = canEditRemark(input.actor, remark);
  if (!rule.ok) return rule;
  if (remark.text === input.text) {
    return { ok: false, status: 400, error: 'Текст замечания не изменился' };
  }
  const changed = await prisma.$transaction(async (tx) => {
    const updated = await tx.acceptanceRemark.updateMany({
      where: { id: remark.id, status: 'open', text: remark.text },
      data: { text: input.text },
    });
    if (updated.count === 0) return false;
    await tx.acceptanceRemarkEdit.create({
      data: {
        remarkId: remark.id,
        previousText: remark.text,
        newText: input.text,
        editedBy: input.actor.name,
        editedById: input.actor.id,
      },
    });
    return true;
  });
  if (!changed) {
    return { ok: false, status: 409, error: 'Замечание уже изменено другим пользователем' };
  }
  const row = await prisma.acceptanceRemark.findUniqueOrThrow({
    where: { id: remark.id },
    include: REMARK_INCLUDE,
  });
  return { ok: true, value: { remark: serializeRemark(row), previousText: remark.text } };
}
