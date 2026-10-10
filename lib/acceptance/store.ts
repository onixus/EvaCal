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
import { loadStoredFile, storeAcceptanceEvidence } from '@/lib/gost34/storage';
import {
  checkRemarkTransition,
  currentStatus,
  evidenceKeyPrefix,
  EVIDENCE_TYPES,
  extractCheckSeeds,
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
}

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
  };
}

const CHECK_INCLUDE = { results: true, remarks: true } as const;

/** Проверки редакции комплекта с полной историей результатов и замечаний. */
export async function listChecks(packageId: string): Promise<SerializedCheck[]> {
  const rows = (await prisma.acceptanceCheck.findMany({
    where: { packageId },
    orderBy: [{ order: 'asc' }, { id: 'asc' }],
    include: CHECK_INCLUDE,
  })) as CheckRow[];
  return rows.map(serializeCheck);
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

/**
 * Сохраняет вложение проверки и возвращает ссылку на него. Ключ строит
 * сервер: имя файла пользователя в путь не попадает.
 */
export async function uploadEvidence(input: {
  packageId: string;
  checkId: string;
  fileName: string;
  ext: string;
  mime: string;
  buffer: Buffer;
  uploadedBy: string;
}): Promise<EvidenceRef> {
  const key = `${evidenceKeyPrefix(input.packageId, input.checkId)}${randomUUID()}.${input.ext}`;
  const stored = await storeAcceptanceEvidence(key, input.buffer);
  return {
    key: stored.artifactPath,
    name: input.fileName.slice(0, 255),
    size: stored.sizeBytes,
    mime: input.mime,
    checksum: stored.checksum,
    uploadedAt: new Date().toISOString(),
    uploadedBy: input.uploadedBy,
  };
}

/**
 * Сверяет ссылки на вложения с хранилищем: файл должен существовать, а
 * размер и контрольную сумму сервер берёт из самого файла, а не из запроса.
 */
export async function resolveEvidence(refs: EvidenceRef[]): Promise<RuleResult<EvidenceRef[]>> {
  const resolved: EvidenceRef[] = [];
  for (const ref of refs) {
    const file = await loadStoredFile(ref.key);
    if (!file) return { ok: false, status: 400, error: `Вложение «${ref.name}» не найдено` };
    const ext = ref.key.split('.').pop() ?? '';
    resolved.push({
      ...ref,
      size: file.buffer.length,
      checksum: file.checksum,
      mime: EVIDENCE_TYPES[ext]?.[0] ?? 'application/octet-stream',
    });
  }
  return { ok: true, value: resolved };
}

/** Вложение, на которое ссылается хотя бы один результат проверки. */
export async function findEvidence(checkId: string, key: string): Promise<EvidenceRef | null> {
  const results = await prisma.acceptanceResult.findMany({
    where: { checkId },
    select: { evidence: true },
  });
  for (const r of results) {
    const refs = Array.isArray(r.evidence) ? (r.evidence as unknown as EvidenceRef[]) : [];
    const hit = refs.find((e) => e && e.key === key);
    if (hit) return hit;
  }
  return null;
}

/**
 * Записывает результат (новая строка, старые не трогаются). Если передан
 * текст замечания, оно создаётся в той же транзакции и ссылается на результат.
 */
export async function recordResult(input: {
  checkId: string;
  result: NormalizedResult;
  executorId: string | null;
  evidence: EvidenceRef[];
  recordedBy: string;
  remarkText?: string | null;
}): Promise<{ result: SerializedResult; remark: SerializedRemark | null }> {
  return prisma.$transaction(async (tx) => {
    const row = await tx.acceptanceResult.create({
      data: {
        checkId: input.checkId,
        status: input.result.status,
        executorName: input.result.executorName,
        executorId: input.executorId,
        executedAt: input.result.executedAt,
        actualResult: input.result.actualResult,
        evidence: input.evidence as never,
        recordedBy: input.recordedBy,
      },
    });
    const remark = input.remarkText
      ? await tx.acceptanceRemark.create({
          data: {
            checkId: input.checkId,
            resultId: row.id,
            text: input.remarkText,
            createdBy: input.recordedBy,
          },
        })
      : null;
    return {
      result: serializeResult(row),
      remark: remark ? serializeRemark(remark) : null,
    };
  });
}

export async function createRemark(input: {
  checkId: string;
  resultId: string | null;
  text: string;
  createdBy: string;
}): Promise<SerializedRemark> {
  return serializeRemark(await prisma.acceptanceRemark.create({ data: input }));
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
  const row = await prisma.acceptanceRemark.findUniqueOrThrow({ where: { id: remark.id } });
  return { ok: true, value: serializeRemark(row) };
}

/** Правка текста открытого замечания. */
export async function editRemarkText(input: {
  checkId: string;
  remarkId: string;
  text: string;
}): Promise<RuleResult<SerializedRemark>> {
  const updated = await prisma.acceptanceRemark.updateMany({
    where: { id: input.remarkId, checkId: input.checkId, status: 'open' },
    data: { text: input.text },
  });
  if (updated.count === 0) {
    return {
      ok: false,
      status: 409,
      error: 'Править можно только открытое замечание этой проверки',
    };
  }
  const row = await prisma.acceptanceRemark.findUniqueOrThrow({ where: { id: input.remarkId } });
  return { ok: true, value: serializeRemark(row) };
}
