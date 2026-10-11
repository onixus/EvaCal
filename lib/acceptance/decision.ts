/**
 * Решение приёмочной комиссии (#103 WP-4b) — чистые правила.
 *
 *  - Решение принимается только по редакции, у которой есть проверки.
 *  - «Принять» — только если каждая проверка пройдена, без открытых замечаний
 *    и без пометки «требует пересмотра» из-за запроса на изменение.
 *  - «Принять с замечаниями» — только с явным перечнем: каждая непройденная,
 *    заблокированная, непроведённая или требующая пересмотра проверка должна
 *    быть в перечне с описанием, что устранить; чистые проверки в перечень не
 *    входят.
 *  - «Не принимать» — с основанием (основание обязательно для всех решений).
 *  - Решения только дописываются; действующее — последнее. Если после него
 *    записан новый результат или заведена новая проверка, решение устарело:
 *    его выводы не печатаются, пока комиссия не вынесет новое.
 */
import type { AcceptanceStatus, RuleResult } from './rules';
import type { SerializedCheck } from './types';

export type DecisionKind = 'accepted' | 'accepted_with_remarks' | 'rejected';

export const DECISION_KINDS: DecisionKind[] = ['accepted', 'accepted_with_remarks', 'rejected'];

export const DECISION_KIND_LABELS: Record<DecisionKind, string> = {
  accepted: 'Принять',
  accepted_with_remarks: 'Принять с замечаниями',
  rejected: 'Не принимать',
};

export function isDecisionKind(value: unknown): value is DecisionKind {
  return typeof value === 'string' && (DECISION_KINDS as string[]).includes(value);
}

export interface CommissionMember {
  name: string;
  position?: string;
  organization?: string;
}

export interface DecisionException {
  checkId: string;
  requirementCode: string;
  note: string;
}

export interface DecisionCheckInput {
  id: string;
  requirementCode: string;
  status: AcceptanceStatus;
  openRemarks: number;
  /** Проверка затронута запросом на изменение и требует пересмотра. */
  needsReview: boolean;
  latestResultId: string | null;
}

export interface NormalizedDecision {
  decision: DecisionKind;
  commission: CommissionMember[];
  basis: string;
  exceptions: DecisionException[];
  checksSnapshot: {
    checkId: string;
    requirementCode: string;
    status: AcceptanceStatus;
    resultId: string | null;
    openRemarks: number;
    needsReview: boolean;
  }[];
}

const deny = (status: number, error: string) => ({ ok: false as const, status, error });
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Проверка не «чистая»: не пройдена, есть открытые замечания или нужен пересмотр. */
export function isOutstanding(check: DecisionCheckInput): boolean {
  return check.status !== 'passed' || check.openRemarks > 0 || check.needsReview;
}

export const MAX_COMMISSION = 20;

export function validateDecisionInput(
  input: { decision?: unknown; commission?: unknown; basis?: unknown; exceptions?: unknown },
  checks: DecisionCheckInput[],
): RuleResult<NormalizedDecision> {
  if (checks.length === 0) {
    return deny(409, 'Решение принимается по результатам проверок: у редакции нет проверок');
  }
  if (!isDecisionKind(input.decision)) {
    return deny(400, 'Решение: accepted, accepted_with_remarks или rejected');
  }
  const decision = input.decision;

  if (!Array.isArray(input.commission) || input.commission.length === 0) {
    return deny(400, 'Укажите состав комиссии');
  }
  if (input.commission.length > MAX_COMMISSION) {
    return deny(400, `Не больше ${MAX_COMMISSION} членов комиссии`);
  }
  const commission: CommissionMember[] = [];
  for (const raw of input.commission) {
    const m = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const name = str(m.name).slice(0, 200);
    if (!name) return deny(400, 'У каждого члена комиссии должно быть указано ФИО');
    const member: CommissionMember = { name };
    const position = str(m.position).slice(0, 200);
    const organization = str(m.organization).slice(0, 200);
    if (position) member.position = position;
    if (organization) member.organization = organization;
    commission.push(member);
  }

  const basis = str(input.basis).slice(0, 2000);
  if (!basis) return deny(400, 'Укажите основание решения (протокол, заседание комиссии)');

  const byId = new Map(checks.map((c) => [c.id, c]));
  const outstanding = checks.filter(isOutstanding);
  const rawExceptions = input.exceptions ?? [];
  if (!Array.isArray(rawExceptions)) return deny(400, 'Перечень замечаний передаётся списком');
  const exceptions: DecisionException[] = [];
  for (const raw of rawExceptions) {
    const e = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const check = byId.get(str(e.checkId));
    if (!check) return deny(400, 'Перечень ссылается на проверку другой редакции');
    if (!isOutstanding(check)) {
      return deny(
        400,
        `Проверка ${check.requirementCode} пройдена без замечаний — её нет в перечне`,
      );
    }
    const note = str(e.note).slice(0, 2000);
    if (!note) return deny(400, `Опишите замечание по проверке ${check.requirementCode}`);
    if (exceptions.some((x) => x.checkId === check.id)) {
      return deny(400, `Проверка ${check.requirementCode} указана в перечне дважды`);
    }
    exceptions.push({ checkId: check.id, requirementCode: check.requirementCode, note });
  }

  if (decision === 'accepted') {
    if (outstanding.length > 0) {
      return deny(
        409,
        `«Принять» недоступно: проверки не пройдены, не проведены, с открытыми замечаниями или требуют пересмотра — ${outstanding
          .map((c) => c.requirementCode)
          .join(', ')}. Выберите «принять с замечаниями» с перечнем или «не принимать».`,
      );
    }
    if (exceptions.length) return deny(400, 'У решения «принять» перечня замечаний нет');
  }
  if (decision === 'accepted_with_remarks') {
    if (outstanding.length === 0) {
      return deny(400, 'Все проверки пройдены без замечаний — выберите «принять»');
    }
    const missing = outstanding.filter((c) => !exceptions.some((e) => e.checkId === c.id));
    if (missing.length) {
      return deny(
        400,
        `В перечне замечаний нет проверок: ${missing.map((c) => c.requirementCode).join(', ')}`,
      );
    }
  }
  if (decision === 'rejected' && exceptions.length) {
    return deny(400, 'У решения «не принимать» перечня замечаний нет — укажите основание');
  }

  return {
    ok: true,
    value: {
      decision,
      commission,
      basis,
      exceptions,
      checksSnapshot: checks.map((c) => ({
        checkId: c.id,
        requirementCode: c.requirementCode,
        status: c.status,
        resultId: c.latestResultId,
        openRemarks: c.openRemarks,
        needsReview: c.needsReview,
      })),
    },
  };
}

export interface DecisionLike {
  id: string;
  decision: string;
  decidedAt: Date | string;
  checksSnapshot: unknown;
}

/** Текущее состояние проверки для сверки со снимком решения. */
export interface DecisionCheckState extends DecisionCheckInput {
  latestResultAt: Date | string | null;
}

interface SnapshotEntry {
  checkId: string;
  resultId: string | null;
  openRemarks?: number;
  needsReview?: boolean;
}

const ts = (d: Date | string) => (d instanceof Date ? d.getTime() : new Date(d).getTime());

/**
 * Действующее решение и признак устаревания. Решение устарело, если факты
 * разошлись со снимком: по проверке записан новый результат, изменилось
 * число открытых замечаний или пометка пересмотра по запросу на изменение,
 * появилась новая проверка. Решение «принять» устаревает и тогда, когда
 * хотя бы одна проверка сейчас не «чистая» (не пройдена, есть замечание или
 * пересмотр) — даже если снимок формально совпадает.
 */
export function currentDecision<T extends DecisionLike>(
  decisions: T[],
  checks: DecisionCheckState[],
): { decision: T | null; stale: boolean; latest: T | null } {
  const latest =
    [...decisions].sort((a, b) => ts(b.decidedAt) - ts(a.decidedAt) || (a.id < b.id ? 1 : -1))[0] ??
    null;
  if (!latest) return { decision: null, stale: false, latest: null };
  const snapshot = Array.isArray(latest.checksSnapshot)
    ? (latest.checksSnapshot as SnapshotEntry[])
    : [];
  const snap = new Map(snapshot.map((s) => [s.checkId, s]));
  const stale =
    checks.some((c) => {
      const s = snap.get(c.id);
      return (
        !s ||
        s.resultId !== c.latestResultId ||
        (s.openRemarks ?? 0) !== c.openRemarks ||
        (s.needsReview ?? false) !== c.needsReview ||
        (c.latestResultAt !== null && ts(c.latestResultAt) > ts(latest.decidedAt))
      );
    }) ||
    (latest.decision === 'accepted' && checks.some(isOutstanding));
  return { decision: stale ? null : latest, stale, latest };
}

/** Вход правил решения из сериализованных проверок (сервер и экран — одинаково). */
export function decisionInputs(checks: SerializedCheck[]): DecisionCheckInput[] {
  return checks.map((c) => ({
    id: c.id,
    requirementCode: c.requirementCode,
    status: c.status,
    openRemarks: c.openRemarks,
    needsReview: c.needsReview.length > 0,
    latestResultId: c.latest?.id ?? null,
  }));
}
