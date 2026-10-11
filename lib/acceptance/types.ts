/** Сериализованные формы проверок приёмки для API и экрана испытаний (#103 WP-4a). */
import type { VerificationMethod } from '@/lib/gost34/requirements/v2';
import type { AcceptanceStatus, AcceptanceSummary, EvidenceRef, RemarkStatus } from './rules';
import type { DecisionKind, CommissionMember, DecisionException } from './decision';
import type { ReviewFlag } from './review';

export interface SerializedResult {
  id: string;
  checkId: string;
  status: AcceptanceStatus;
  executorName: string | null;
  executorId: string | null;
  executedAt: string | null;
  actualResult: string | null;
  evidence: EvidenceRef[];
  recordedBy: string;
  createdAt: string;
}

export interface SerializedRemark {
  id: string;
  checkId: string;
  resultId: string | null;
  text: string;
  status: RemarkStatus;
  retestResultId: string | null;
  createdBy: string;
  createdAt: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  /** Журнал правок текста: прежний и новый текст, кто и когда. */
  edits: {
    id: string;
    previousText: string;
    newText: string;
    editedBy: string;
    editedAt: string;
  }[];
}

export interface SerializedCheck {
  id: string;
  packageId: string;
  requirementId: string;
  requirementCode: string;
  title: string;
  method: VerificationMethod | null;
  criteria: string[];
  order: number;
  /** Последний результат; нет результатов — `not_run`. */
  status: AcceptanceStatus;
  latest: SerializedResult | null;
  /** Все результаты, новые сверху. */
  history: SerializedResult[];
  remarks: SerializedRemark[];
  openRemarks: number;
  /**
   * Запросы на изменение, затрагивающие требование проверки (на оценке или
   * принятые): проверку нужно пересмотреть. Вычисляется, не хранится.
   */
  needsReview: ReviewFlag[];
}

export interface ChecksResponse {
  packageId: string;
  packageVersion: number;
  eligible: boolean;
  canRecord: boolean;
  /** Сколько требований снимка ещё не превращено в проверки. */
  pendingSeeds: number;
  checks: SerializedCheck[];
  summary: AcceptanceSummary;
  /** Проверок с пометкой «требует пересмотра». */
  needsReviewCount: number;
  decision: DecisionState;
}

export interface SerializedDecision {
  id: string;
  packageId: string;
  decision: DecisionKind;
  commission: CommissionMember[];
  basis: string;
  exceptions: DecisionException[];
  decidedBy: string;
  decidedAt: string;
}

export interface DecisionState {
  /** Действующее решение; null — нет или устарело. */
  current: SerializedDecision | null;
  /** Последнее решение устарело: после него менялись результаты. */
  stale: boolean;
  history: SerializedDecision[];
}
