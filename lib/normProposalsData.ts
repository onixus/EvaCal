/**
 * Предложения нормативов (#103 WP-6c): работа с БД. Логика выборки и
 * статистики — `lib/normProposals.ts`, правила — `docs/norm-proposals.md`.
 *
 * Генерация и решения по одному шаблону сериализуются транзакционной
 * advisory-блокировкой; частичный уникальный индекс `NormProposal_open_key`
 * дополнительно не даёт появиться двум открытым предложениям на этап.
 */
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/lib/generated/prisma/client';
import { safeJsonParse } from '@/lib/json';
import {
  buildNormProposals,
  snapshotMatches,
  type NormCalcRow,
  type NormSkip,
} from '@/lib/normProposals';

type Tx = Prisma.TransactionClient;

/**
 * Блокировка нормативов шаблона: генерация, решения по предложениям и правка
 * этапов шаблона (`PUT /api/templates/:id/stage-templates/:stId`) идут по очереди.
 */
export async function lockTemplate(tx: Tx, formTemplateId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`norms:${formTemplateId}`}))`;
}

/** Выигранные версии расчётов шаблона с фактом этапов. */
export async function loadNormInputs(tx: Tx, formTemplateId: string) {
  const [stageTemplates, calcs] = await Promise.all([
    tx.stageTemplate.findMany({
      where: { templateId: formTemplateId },
      orderBy: { order: 'asc' },
      select: {
        id: true,
        name: true,
        role: true,
        baseHours: true,
        hoursPerUnit: true,
        driverFieldKey: true,
      },
    }),
    tx.calculation.findMany({
      where: { templateId: formTemplateId, project: { dealStatus: 'won' } },
      select: {
        id: true,
        name: true,
        version: true,
        answers: true,
        project: { select: { wonCalculationId: true, actualsClosedAt: true } },
        stages: {
          select: {
            id: true,
            name: true,
            role: true,
            hours: true,
            isApprovalTask: true,
            actualHours: true,
            actualEndDate: true,
          },
        },
      },
    }),
  ]);
  const rows: NormCalcRow[] = calcs
    // Факт ведётся только по версии, по которой подписан договор.
    .filter((c) => c.project?.wonCalculationId === c.id)
    .map((c) => ({
      id: c.id,
      name: c.name,
      version: c.version,
      answers: safeJsonParse<Record<string, unknown>>(c.answers, {}),
      actualsClosed: Boolean(c.project?.actualsClosedAt),
      stages: c.stages,
    }));
  return { stageTemplates, calcs: rows };
}

export interface NormGenerationSummary {
  created: number;
  unchanged: number;
  superseded: number;
  skipped: NormSkip[];
}

/**
 * Пересчитывает предложения шаблона. Идемпотентно: открытое предложение с тем
 * же отпечатком остаётся как есть; иначе прежнее открытое помечается
 * `superseded`, и создаётся новое. Открытые предложения этапов, по которым
 * данных для предложения больше нет, тоже становятся `superseded`.
 */
export async function generateNormProposals(
  formTemplateId: string,
  createdBy: string | null,
): Promise<NormGenerationSummary> {
  return prisma.$transaction(async (tx) => {
    await lockTemplate(tx, formTemplateId);
    const { stageTemplates, calcs } = await loadNormInputs(tx, formTemplateId);
    const { drafts, skipped } = buildNormProposals(stageTemplates, calcs);

    const open = await tx.normProposal.findMany({
      where: { formTemplateId, status: 'proposed' },
      select: { id: true, stageTemplateId: true, fingerprint: true },
    });
    const openByStage = new Map(open.map((p) => [p.stageTemplateId, p]));
    // Последнее отклонённое предложение каждого этапа: те же данные — то же
    // предложение, владелец его уже отклонил, повторно не предлагаем.
    const rejected = await tx.normProposal.findMany({
      where: { formTemplateId, status: 'rejected' },
      orderBy: [{ decidedAt: 'desc' }, { id: 'desc' }],
      select: { stageTemplateId: true, fingerprint: true },
    });
    const lastRejected = new Map<string, string>();
    for (const r of rejected) {
      if (!lastRejected.has(r.stageTemplateId)) lastRejected.set(r.stageTemplateId, r.fingerprint);
    }
    const now = new Date();
    let created = 0;
    let unchanged = 0;
    let superseded = 0;
    const keep = new Set<string>();

    for (const d of drafts) {
      if (lastRejected.get(d.stageTemplateId) === d.fingerprint) {
        skipped.push({
          stageTemplateId: d.stageTemplateId,
          stageName: d.stageName,
          reason: 'rejected-same-data',
        });
        continue;
      }
      const existing = openByStage.get(d.stageTemplateId);
      if (existing && existing.fingerprint === d.fingerprint) {
        keep.add(existing.id);
        unchanged += 1;
        continue;
      }
      if (existing) {
        await tx.normProposal.update({
          where: { id: existing.id },
          data: { status: 'superseded', decidedAt: now, decidedBy: createdBy },
        });
        keep.add(existing.id);
        superseded += 1;
      }
      await tx.normProposal.create({
        data: {
          stageTemplateId: d.stageTemplateId,
          formTemplateId,
          currentStageName: d.currentStageName,
          currentStageRole: d.currentStageRole,
          currentDriverFieldKey: d.currentDriverFieldKey,
          currentBaseHours: d.currentBaseHours,
          currentHoursPerUnit: d.currentHoursPerUnit,
          proposedBaseHours: d.proposedBaseHours,
          proposedHoursPerUnit: d.proposedHoursPerUnit,
          sampleSize: d.sampleSize,
          completeness: d.completeness,
          confidence: d.confidence,
          explanation: d.explanation as unknown as Prisma.InputJsonValue,
          fingerprint: d.fingerprint,
          createdBy,
        },
      });
      created += 1;
    }

    const stale = open.filter((p) => !keep.has(p.id)).map((p) => p.id);
    if (stale.length > 0) {
      const res = await tx.normProposal.updateMany({
        where: { id: { in: stale }, status: 'proposed' },
        data: { status: 'superseded', decidedAt: now, decidedBy: createdBy },
      });
      superseded += res.count;
    }
    return { created, unchanged, superseded, skipped };
  });
}

export async function listNormProposals(formTemplateId: string, limit = 100) {
  return prisma.normProposal.findMany({
    where: { formTemplateId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
    include: { stageTemplate: { select: { name: true, role: true } } },
  });
}

export type NormDecision = 'approve' | 'reject';

export type NormDecisionResult =
  | {
      ok: true;
      proposal: { id: string; status: string; stageTemplateId: string };
      before: { baseHours: number; hoursPerUnit: number };
      after: { baseHours: number; hoursPerUnit: number };
    }
  | { ok: false; status: number; error: string };

/**
 * Решение владельца шаблона. Утверждение меняет только `StageTemplate`
 * (действует для новых расчётов): этапы существующих расчётов — копии и не
 * пересчитываются. Если этап шаблона (норматив, драйвер, имя, роль) изменили
 * после формирования предложения, утверждение отклоняется (409).
 */
export async function decideNormProposal(input: {
  formTemplateId: string;
  proposalId: string;
  decision: NormDecision;
  decidedBy: string;
  comment: string | null;
}): Promise<NormDecisionResult> {
  return prisma.$transaction(async (tx) => {
    await lockTemplate(tx, input.formTemplateId);
    const p = await tx.normProposal.findUnique({ where: { id: input.proposalId } });
    if (!p || p.formTemplateId !== input.formTemplateId) {
      return { ok: false as const, status: 404, error: 'Предложение не найдено' };
    }
    if (p.status !== 'proposed') {
      return { ok: false as const, status: 409, error: 'Решение по предложению уже принято' };
    }
    const st = await tx.stageTemplate.findUnique({
      where: { id: p.stageTemplateId },
      select: { name: true, role: true, driverFieldKey: true, baseHours: true, hoursPerUnit: true },
    });
    if (!st) return { ok: false as const, status: 404, error: 'Этап шаблона удалён' };
    const before = { baseHours: st.baseHours, hoursPerUnit: st.hoursPerUnit };
    const now = new Date();

    if (input.decision === 'reject') {
      const updated = await tx.normProposal.update({
        where: { id: p.id },
        data: {
          status: 'rejected',
          decidedBy: input.decidedBy,
          decidedAt: now,
          decisionComment: input.comment,
        },
      });
      return { ok: true as const, proposal: updated, before, after: before };
    }

    const stale = {
      ok: false as const,
      status: 409,
      error:
        'Этап шаблона (норматив, драйвер, имя или роль) изменился после формирования предложения — сформируйте заново',
    };
    if (!snapshotMatches(p, st)) return stale;
    const after = { baseHours: p.proposedBaseHours, hoursPerUnit: p.proposedHoursPerUnit };
    // Условное обновление: даже если правка этапа прошла мимо блокировки,
    // норматив меняется только при совпадении со снимком.
    const res = await tx.stageTemplate.updateMany({
      where: {
        id: p.stageTemplateId,
        name: p.currentStageName,
        role: p.currentStageRole,
        driverFieldKey: p.currentDriverFieldKey,
        baseHours: p.currentBaseHours,
        hoursPerUnit: p.currentHoursPerUnit,
      },
      data: after,
    });
    if (res.count !== 1) return stale;
    const updated = await tx.normProposal.update({
      where: { id: p.id },
      data: {
        status: 'approved',
        decidedBy: input.decidedBy,
        decidedAt: now,
        decisionComment: input.comment,
      },
    });
    return { ok: true as const, proposal: updated, before, after };
  });
}
