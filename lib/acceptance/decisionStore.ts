/**
 * Решения приёмочной комиссии и факты испытаний для ПСИ и акта (#103 WP-4b).
 */
import { prisma } from '@/lib/prisma';
import type { Gost34AcceptanceFacts } from '@/lib/gost34/types';
import {
  currentDecision,
  type CommissionMember,
  type DecisionException,
  type DecisionKind,
  type NormalizedDecision,
} from './decision';
import { isPackageEligibleForChecks } from './rules';
import { listChecksWithFlags } from './store';
import type { DecisionState, SerializedCheck, SerializedDecision } from './types';
export { decisionInputs } from './decision';

interface DecisionRow {
  id: string;
  packageId: string;
  decision: string;
  commission: unknown;
  basis: string;
  exceptions: unknown;
  checksSnapshot: unknown;
  decidedBy: string;
  decidedAt: Date;
}

export function serializeDecision(row: DecisionRow): SerializedDecision {
  return {
    id: row.id,
    packageId: row.packageId,
    decision: row.decision as DecisionKind,
    commission: Array.isArray(row.commission) ? (row.commission as CommissionMember[]) : [],
    basis: row.basis,
    exceptions: Array.isArray(row.exceptions) ? (row.exceptions as DecisionException[]) : [],
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt.toISOString(),
  };
}

/** Действующее решение редакции, признак устаревания и история (новые сверху). */
export async function loadDecisionState(
  packageId: string,
  checks: SerializedCheck[],
): Promise<DecisionState> {
  const rows = await prisma.acceptanceDecision.findMany({
    where: { packageId },
    orderBy: [{ decidedAt: 'desc' }, { id: 'desc' }],
  });
  const { decision, stale } = currentDecision(
    rows,
    checks.map((c) => ({
      id: c.id,
      latestResultId: c.latest?.id ?? null,
      latestResultAt: c.latest?.createdAt ?? null,
    })),
  );
  return {
    current: decision ? serializeDecision(decision) : null,
    stale,
    history: rows.map(serializeDecision),
  };
}

export async function recordDecision(input: {
  packageId: string;
  value: NormalizedDecision;
  decidedBy: string;
  decidedById: string;
}): Promise<SerializedDecision> {
  const row = await prisma.acceptanceDecision.create({
    data: {
      packageId: input.packageId,
      decision: input.value.decision,
      commission: input.value.commission as never,
      basis: input.value.basis,
      exceptions: input.value.exceptions as never,
      checksSnapshot: input.value.checksSnapshot as never,
      decidedBy: input.decidedBy,
      decidedById: input.decidedById,
    },
  });
  return serializeDecision(row);
}

/** Сведения о редакции, по которой собраны факты (для снимка выпуска). */
export interface AcceptanceSource {
  packageId: string;
  packageVersion: number;
  decisionId: string | null;
}

/**
 * Факты испытаний для ПСИ и акта.
 *
 * Редакция выбирается явно (`packageId`, должна относиться к расчёту и быть
 * утверждённой) или по умолчанию — последняя утверждённая редакция расчёта, у
 * которой есть проверки. Нет такой редакции — `undefined`: документ печатается
 * с пустыми полями для комиссии. Явно указанная, но неподходящая редакция —
 * ошибка (`AcceptanceSourceError`), а не тихая подмена.
 */
export async function loadAcceptanceFacts(input: {
  calculationId: string;
  packageId?: string | null;
}): Promise<Gost34AcceptanceFacts | undefined> {
  const pkg = input.packageId
    ? await prisma.gostPackage.findUnique({ where: { id: input.packageId } })
    : await prisma.gostPackage.findFirst({
        where: {
          calculationId: input.calculationId,
          OR: [{ status: 'approved' }, { reviewStage: 'done', status: { not: 'archived' } }],
          acceptanceChecks: { some: {} },
        },
        orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
      });
  if (input.packageId) {
    if (!pkg || pkg.calculationId !== input.calculationId) {
      throw new AcceptanceSourceError('Редакция для фактов испытаний не относится к расчёту');
    }
    if (!isPackageEligibleForChecks(pkg)) {
      throw new AcceptanceSourceError('Факты испытаний берутся только из утверждённой редакции');
    }
  }
  if (!pkg) return undefined;

  const checks = await listChecksWithFlags(pkg);
  if (checks.length === 0) return undefined;
  const state = await loadDecisionState(pkg.id, checks);
  return {
    packageId: pkg.id,
    packageVersion: pkg.version,
    checks: checks.map((c) => ({
      requirementId: c.requirementId,
      requirementCode: c.requirementCode,
      title: c.title,
      criteria: c.criteria,
      status: c.status,
      actualResult: c.latest?.actualResult ?? null,
      executorName: c.latest?.executorName ?? null,
      executedAt: c.latest?.executedAt ?? null,
      openRemarks: c.openRemarks,
    })),
    decision: state.current
      ? {
          id: state.current.id,
          decision: state.current.decision,
          commission: state.current.commission,
          basis: state.current.basis,
          exceptions: state.current.exceptions.map((e) => ({
            requirementCode: e.requirementCode,
            note: e.note,
          })),
          decidedBy: state.current.decidedBy,
          decidedAt: state.current.decidedAt,
        }
      : null,
    decisionStale: state.stale,
  };
}

export class AcceptanceSourceError extends Error {
  readonly status = 400;
}

/** Нужны ли документу факты испытаний. */
export function needsAcceptanceFacts(docTypes: string[]): boolean {
  return docTypes.some((d) => d === 'PSI' || d === 'ACT');
}
