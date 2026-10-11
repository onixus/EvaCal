/**
 * Порог прибыльности и согласование скидки (#103 §4.3): чистая логика.
 *
 * Порог — минимальная маржа КП (% от выручки без НДС, с поставкой), копируется
 * из шаблона в расчёт при создании. Расчёт с маржой ниже порога (или с
 * неопределённой маржой: неполные данные, нулевая выручка) утверждается только
 * при согласованной скидке: отпечаток условий КП одобренной заявки
 * (lib/offerFingerprint.ts) должен совпадать с текущим. Любое изменение условий
 * — спецификации, статей, процентов, скидки, известных сумм, списка неполных
 * данных — требует новой заявки, и при известной, и при неопределённой марже.
 */

export const DISCOUNT_APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'withdrawn'] as const;
export type DiscountApprovalStatus = (typeof DISCOUNT_APPROVAL_STATUSES)[number];
export const DISCOUNT_APPROVAL_STATUS_LABELS: Record<DiscountApprovalStatus, string> = {
  pending: 'ожидает решения',
  approved: 'согласована',
  rejected: 'отклонена',
  withdrawn: 'отозвана',
};

/** Кто запрашивает и кто решает. Решающий не может согласовать собственную заявку. */
export const DISCOUNT_REQUEST_ROLES = ['presale', 'architect', 'admin'];
export const DISCOUNT_DECIDE_ROLES = ['architect', 'admin'];

export interface ApprovalRow {
  id: string;
  status: string;
  requestedPercent: number;
  resultingMargin: number | null;
  termsFingerprint: string;
}

export interface MarginGateInput {
  minMarginPercent: number | null;
  /** Маржа итога КП; null — не определена. */
  marginPercent: number | null;
  /** Итог КП неполный (неизвестные цены/себестоимость/курсы). */
  incomplete: boolean;
  discountPercent: number;
  /** Отпечаток текущих условий КП. */
  fingerprint: string;
  approvals: ApprovalRow[];
}

export type MarginGateState = 'no_threshold' | 'ok' | 'below' | 'unknown';

export interface MarginGate {
  state: MarginGateState;
  /** Утверждение требует согласованной скидки. */
  requiresApproval: boolean;
  /** Есть согласование, соответствующее текущим условиям. */
  approved: boolean;
  approvalId: string | null;
  /** Маржа, округлённая до сотых, с которой сравнивается порог. */
  margin: number | null;
  message: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const EPS = 1e-9;

/** Одобренная заявка подходит только при тех же условиях КП (тот же отпечаток). */
export function approvalMatches(a: ApprovalRow, fingerprint: string): boolean {
  return a.status === 'approved' && a.termsFingerprint === fingerprint;
}

export function marginGate(input: MarginGateInput): MarginGate {
  const margin = input.marginPercent === null ? null : round2(input.marginPercent);
  if (input.minMarginPercent === null) {
    return {
      state: 'no_threshold',
      requiresApproval: false,
      approved: false,
      approvalId: null,
      margin,
      message: 'Порог маржи не задан.',
    };
  }
  const min = input.minMarginPercent;
  const effective = input.incomplete ? null : margin;
  if (effective !== null && effective + EPS >= min) {
    return {
      state: 'ok',
      requiresApproval: false,
      approved: false,
      approvalId: null,
      margin,
      message: `Маржа ${effective}% не ниже порога ${min}%.`,
    };
  }
  const match = input.approvals.find((a) => approvalMatches(a, input.fingerprint));
  const state: MarginGateState = effective === null ? 'unknown' : 'below';
  const reason =
    state === 'unknown'
      ? `Маржа не определена${input.incomplete ? ' (неполные данные КП)' : ''}; порог ${min}%.`
      : `Маржа ${effective}% ниже порога ${min}%.`;
  return {
    state,
    requiresApproval: true,
    approved: Boolean(match),
    approvalId: match?.id ?? null,
    margin: effective,
    message: match
      ? `${reason} Скидка ${input.discountPercent}% согласована.`
      : `${reason} Утверждение — только после согласования скидки ${input.discountPercent}%.`,
  };
}
