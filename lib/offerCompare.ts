/**
 * Сравнение вариантов КП (#103 4.4): чистая логика без Prisma.
 *
 * Каждый вариант — сохранённая версия расчёта проекта. Цена и себестоимость
 * пересчитываются тем же `calculateCommercialSummary`, что и КП, но только по
 * сохранённым в версии ставкам, режиму цены, процентам и датам этапов: текущие
 * ставки шаблона сюда не попадают, поэтому первоначальное КП воспроизводимо, а
 * изменение ставок не переписывает историю. Спецификация показывается отдельно
 * (только подтверждённая редакция) и не складывается с ценой труда; неизвестная
 * стоимость строки — не 0.
 */
import {
  PRICING_MODE_LABELS,
  calculateCommercialSummary,
  formatCurrency,
  type CommercialConfig,
  type CommercialSummary,
} from './commercial';
import { describeTotal, summarizeSpecification } from './specification/totals';
import type {
  SpecificationCurrencyTotal,
  SpecificationItem,
  SpecificationStatus,
} from './specification/types';

export const MAX_COMPARED_OFFERS = 6;

export interface OfferVersionInput {
  id: string;
  version: number;
  name: string;
  status: string;
  versionComment: string | null;
  createdAt: Date | string;
  startDate: Date | string;
  pmHours: number;
  terms: Required<Pick<CommercialConfig, 'currency' | 'pricingMode'>> &
    Omit<CommercialConfig, 'currency' | 'pricingMode'>;
  stages: {
    name: string;
    role: string;
    hours: number;
    isApprovalTask: boolean;
    startDate: Date | string;
    endDate: Date | string;
  }[];
  risks: { description: string; hours: number }[];
  /** Последняя подтверждённая (confirmed/released) редакция спецификации версии. */
  specification: {
    version: number;
    status: SpecificationStatus;
    items: SpecificationItem[];
    emptySupplyReason: string;
  } | null;
  /** Последняя редакция спецификации любого статуса (для пояснения). */
  latestSpecification: { version: number; status: string } | null;
}

export interface OfferSpecification {
  state: 'none' | 'not_confirmed' | 'confirmed';
  version: number | null;
  status: string | null;
  totals: SpecificationCurrencyTotal[];
  /** Хотя бы одна валюта с неизвестной стоимостью строк: сумма — нижняя граница. */
  incomplete: boolean;
  lines: string[];
}

export interface OfferTerm {
  start: string;
  end: string;
  calendarDays: number;
}

export interface OfferVariant {
  id: string;
  version: number;
  name: string;
  status: string;
  versionComment: string | null;
  createdAt: string;
  currency: string;
  pricingMode: CommercialSummary['pricingMode'];
  pricingModeLabel: string;
  terms: {
    overheadPercent: number;
    marginPercent: number;
    discountPercent: number;
    vatPercent: number;
    includeVat: boolean;
  };
  /** Ставки, применённые в варианте: только роли, которые есть в составе. */
  rates: { role: string; label: string; rate: number; source: 'stored' | 'default' }[];
  /**
   * `stored` — ставки всех ролей состава сохранены в версии; `partial` — часть
   * ролей взята из ставок по умолчанию приложения; `default` — ставок в версии нет.
   */
  ratesCoverage: 'stored' | 'partial' | 'default';
  composition: {
    stageCount: number;
    stages: { name: string; role: string; hours: number }[];
    riskCount: number;
    risks: { description: string; hours: number }[];
    stageHours: number;
    pmHours: number;
    riskHours: number;
    totalHours: number;
  };
  money: {
    directLaborCost: number;
    overheadAmount: number;
    totalCost: number;
    priceBeforeDiscount: number;
    discountAmount: number;
    subtotalExVat: number;
    profit: number;
    marginPercent: number | null;
    vatAmount: number;
    grandTotal: number;
  };
  term: OfferTerm | null;
  specification: OfferSpecification;
  /** Пояснение к каждому числу: как оно получено из сохранённых данных версии. */
  explain: {
    hours: string;
    cost: string;
    price: string;
    profit: string;
    margin: string;
    term: string;
    specification: string;
  };
  delta: OfferDelta | null;
}

export interface OfferDelta {
  baselineId: string;
  totalHours: number;
  /** null — валюты отличаются, денежная разница без курса не считается. */
  totalCost: number | null;
  subtotalExVat: number | null;
  profit: number | null;
  marginPoints: number | null;
  termDays: number | null;
  stagesAdded: string[];
  stagesRemoved: string[];
  stagesChanged: { name: string; from: number; to: number }[];
}

/** Версия, которую нельзя пересчитать (например, недопустимые сохранённые условия). */
export interface OfferVariantError {
  id: string;
  version: number;
  name: string;
  status: string;
  versionComment: string | null;
  createdAt: string;
  error: string;
}

export type OfferResult = OfferVariant | OfferVariantError;

export function isOfferError(v: OfferResult): v is OfferVariantError {
  return 'error' in v;
}

export interface OfferComparison {
  baselineId: string;
  sameCurrency: boolean;
  variants: OfferResult[];
}

const DAY = 86_400_000;

function toDate(v: Date | string): Date {
  return v instanceof Date ? v : new Date(v);
}

function utcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Срок по сохранённым датам Ганта: от самого раннего старта до самого позднего окончания. */
export function offerTerm(stages: OfferVersionInput['stages']): OfferTerm | null {
  if (stages.length === 0) return null;
  let start = Infinity;
  let end = -Infinity;
  for (const s of stages) {
    start = Math.min(start, utcDay(toDate(s.startDate)));
    end = Math.max(end, utcDay(toDate(s.endDate)));
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return {
    start: new Date(start).toISOString().slice(0, 10),
    end: new Date(end).toISOString().slice(0, 10),
    calendarDays: Math.round((end - start) / DAY) + 1,
  };
}

export function offerSpecification(input: OfferVersionInput): OfferSpecification {
  const spec = input.specification;
  if (!spec) {
    const latest = input.latestSpecification;
    return {
      state: latest ? 'not_confirmed' : 'none',
      version: latest?.version ?? null,
      status: latest?.status ?? null,
      totals: [],
      incomplete: false,
      lines: [
        latest
          ? `Спецификация v${latest.version} не подтверждена (${latest.status}): суммы не сравниваются.`
          : 'Спецификации нет.',
      ],
    };
  }
  const totals = summarizeSpecification(spec);
  const lines = totals.length
    ? totals.map(describeTotal)
    : [
        spec.emptySupplyReason
          ? `Поставка не требуется: ${spec.emptySupplyReason}`
          : 'Позиций к поставке нет.',
      ];
  return {
    state: 'confirmed',
    version: spec.version,
    status: spec.status,
    totals,
    incomplete: totals.some((t) => t.incomplete),
    lines,
  };
}

/** Ставки, сохранённые в версии (без подстановки значений по умолчанию). */
function parseStoredRates(raw: CommercialConfig['roleRates']): Record<string, unknown> {
  if (raw === null || raw === undefined || raw === '') return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return raw;
}

function buildVariant(input: OfferVersionInput): OfferVariant {
  const summary = calculateCommercialSummary(input.stages, input.pmHours, input.risks, input.terms);
  const decimals = summary.pricingMode === 'legacy_markup' ? 0 : 2;
  const fmt = (v: number) => formatCurrency(v, summary.currency, { decimals });
  const work = input.stages.filter((s) => !s.isApprovalTask);
  const stageHours = summary.stagesHours;
  const totalHours = summary.directLaborHours;
  const term = offerTerm(input.stages);
  const specification = offerSpecification(input);
  const m = summary.marginPercent;

  const roleCost = summary.rolesBreakdown
    .map((r) => `${r.roleLabel} ${r.hours} ч × ${fmt(r.rate)} = ${fmt(r.cost)}`)
    .join('; ');
  const riskRate = summary.riskHours > 0 ? summary.riskCost / summary.riskHours : 0;
  const priceFormula =
    summary.pricingMode === 'target_margin'
      ? `себестоимость ${fmt(summary.totalCost)} / (1 − ${m}%)`
      : `себестоимость ${fmt(summary.totalCost)} + наценка ${m}% ${fmt(summary.marginAmount)}`;

  const stored = parseStoredRates(input.terms.roleRates);
  const source = (role: string): 'stored' | 'default' =>
    typeof stored[role] === 'number' ? 'stored' : 'default';
  const rates = [
    ...summary.rolesBreakdown.map((r) => ({
      role: r.role,
      label: r.roleLabel,
      rate: r.rate,
      source: source(r.role),
    })),
    ...(summary.pmHours > 0
      ? [
          {
            role: 'pm',
            label: 'Руководитель проекта (РП)',
            rate: summary.pmRate,
            source: source('pm'),
          },
        ]
      : []),
  ];
  const defaulted = rates.filter((r) => r.source === 'default');
  const ratesCoverage: OfferVariant['ratesCoverage'] =
    defaulted.length === 0 ? 'stored' : defaulted.length === rates.length ? 'default' : 'partial';

  return {
    id: input.id,
    version: input.version,
    name: input.name,
    status: input.status,
    versionComment: input.versionComment,
    createdAt: toDate(input.createdAt).toISOString(),
    currency: summary.currency,
    pricingMode: summary.pricingMode,
    pricingModeLabel: PRICING_MODE_LABELS[summary.pricingMode],
    terms: {
      overheadPercent: summary.overheadPercent,
      marginPercent: summary.marginPercent,
      discountPercent: summary.discountPercent,
      vatPercent: summary.vatPercent,
      includeVat: input.terms.includeVat ?? true,
    },
    rates,
    ratesCoverage,
    composition: {
      stageCount: work.length,
      stages: work.map((s) => ({ name: s.name, role: s.role, hours: s.hours })),
      riskCount: input.risks.length,
      risks: input.risks.map((r) => ({ description: r.description, hours: r.hours })),
      stageHours,
      pmHours: summary.pmHours,
      riskHours: summary.riskHours,
      totalHours,
    },
    money: {
      directLaborCost: summary.directLaborCost,
      overheadAmount: summary.overheadAmount,
      totalCost: summary.totalCost,
      priceBeforeDiscount: summary.priceBeforeDiscount,
      discountAmount: summary.discountAmount,
      subtotalExVat: summary.subtotalExVat,
      profit: summary.profitAfterDiscount,
      marginPercent:
        summary.effectiveMarginPercent === null ? null : round2(summary.effectiveMarginPercent),
      vatAmount: summary.vatAmount,
      grandTotal: summary.grandTotal,
    },
    term,
    specification,
    explain: {
      hours: `Этапы ${stageHours} ч (${work.length} шт., без задач согласования) + РП ${summary.pmHours} ч + риски ${summary.riskHours} ч (${input.risks.length} шт.) = ${totalHours} ч.`,
      cost:
        `Труд: ${roleCost || 'этапов нет'}; РП ${summary.pmHours} ч × ${fmt(summary.pmRate)} = ${fmt(summary.pmCost)}; ` +
        `риски ${summary.riskHours} ч × средняя ставка ${fmt(riskRate)} = ${fmt(summary.riskCost)}. ` +
        `Итого труд ${fmt(summary.directLaborCost)} + накладные ${summary.overheadPercent}% ${fmt(summary.overheadAmount)} = ${fmt(summary.totalCost)}. ` +
        (ratesCoverage === 'stored'
          ? 'Ставки — сохранённые в версии.'
          : ratesCoverage === 'default'
            ? 'Ставки в версии не сохранены — применены ставки по умолчанию приложения.'
            : `Ставки частично не сохранены в версии: по умолчанию приложения — ${defaulted.map((r) => r.label).join(', ')}.`),
      price:
        `${summary.pricingMode === 'target_margin' ? 'Целевая маржа' : 'Наценка'} (${PRICING_MODE_LABELS[summary.pricingMode]}): цена до скидки = ${priceFormula} = ${fmt(summary.priceBeforeDiscount)}; ` +
        `скидка ${summary.discountPercent}% = ${fmt(summary.discountAmount)}; цена без НДС = ${fmt(summary.subtotalExVat)}; ` +
        (input.terms.includeVat === false
          ? 'НДС не начисляется.'
          : `НДС ${summary.vatPercent}% = ${fmt(summary.vatAmount)}; к оплате ${fmt(summary.grandTotal)}.`),
      profit: `Прибыль = цена без НДС ${fmt(summary.subtotalExVat)} − себестоимость ${fmt(summary.totalCost)} = ${fmt(summary.profitAfterDiscount)}.`,
      margin:
        summary.effectiveMarginPercent === null
          ? 'Маржа не определена: выручка без НДС равна 0.'
          : `Маржа = прибыль / цена без НДС × 100 = ${round2(summary.effectiveMarginPercent)}% (после скидки, без НДС).`,
      term: term
        ? `С ${term.start} по ${term.end} по сохранённым датам этапов Ганта (включая согласования): ${term.calendarDays} календ. дн.`
        : 'Срок не определён: в версии нет этапов.',
      specification:
        (specification.state === 'confirmed'
          ? `Спецификация v${specification.version}: ${specification.lines.join('; ')}.`
          : specification.lines.join(' ')) +
        ' Стоимость спецификации показывается отдельно и в цену труда не входит.',
    },
    delta: null,
  };
}

function hoursByName(stages: { name: string; hours: number }[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of stages) map.set(s.name, round2((map.get(s.name) ?? 0) + s.hours));
  return map;
}

function variantDelta(base: OfferVariant, v: OfferVariant): OfferDelta {
  const sameCurrency = base.currency === v.currency;
  const money = (pick: (x: OfferVariant) => number) =>
    sameCurrency ? round2(pick(v) - pick(base)) : null;
  const from = hoursByName(base.composition.stages);
  const to = hoursByName(v.composition.stages);
  return {
    baselineId: base.id,
    totalHours: round2(v.composition.totalHours - base.composition.totalHours),
    totalCost: money((x) => x.money.totalCost),
    subtotalExVat: money((x) => x.money.subtotalExVat),
    profit: money((x) => x.money.profit),
    marginPoints:
      v.money.marginPercent === null || base.money.marginPercent === null
        ? null
        : round2(v.money.marginPercent - base.money.marginPercent),
    termDays: v.term && base.term ? v.term.calendarDays - base.term.calendarDays : null,
    stagesAdded: [...to.keys()].filter((n) => !from.has(n)),
    stagesRemoved: [...from.keys()].filter((n) => !to.has(n)),
    stagesChanged: [...to.entries()]
      .filter(([n, h]) => from.has(n) && from.get(n) !== h)
      .map(([name, h]) => ({ name, from: from.get(name) as number, to: h })),
  };
}

/**
 * Сравнивает версии в указанном порядке; первая — база для разниц. Денежные
 * разницы между разными валютами не считаются (null), курс не подставляется.
 */
export function compareOffers(inputs: OfferVersionInput[]): OfferComparison {
  if (inputs.length === 0) throw new Error('Нет версий для сравнения');
  // Одна версия с некорректными сохранёнными условиями не ломает сравнение:
  // она показывается с ошибкой, остальные считаются.
  const variants: OfferResult[] = inputs.map((input) => {
    try {
      return buildVariant(input);
    } catch (e) {
      return {
        id: input.id,
        version: input.version,
        name: input.name,
        status: input.status,
        versionComment: input.versionComment,
        createdAt: toDate(input.createdAt).toISOString(),
        error: `Версию не удалось пересчитать: ${e instanceof Error ? e.message : 'некорректные условия'}`,
      };
    }
  });
  const base = variants[0];
  const computed = variants.filter((v): v is OfferVariant => !isOfferError(v));
  if (!isOfferError(base)) {
    for (const v of computed) if (v !== base) v.delta = variantDelta(base, v);
  }
  return {
    baselineId: base.id,
    sameCurrency: computed.every((v) => v.currency === computed[0]?.currency),
    variants,
  };
}
