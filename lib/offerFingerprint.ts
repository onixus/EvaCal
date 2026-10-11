/**
 * Отпечаток условий КП (#103 §4.3): согласование скидки действует только для
 * тех условий, при которых его выдали. Любое изменение закреплённой
 * спецификации, статей затрат, режима цены, процентов, скидки, известной части
 * цены/себестоимости или списка неполных данных меняет отпечаток — и при
 * известной, и при неопределённой марже требуется новое согласование.
 * Только серверный модуль (node:crypto).
 */
import { createHash } from 'node:crypto';
import type { CommercialSummary } from './commercial';
import type { CostItemInput } from './supply';

export interface OfferTerms {
  pinnedSpecificationVersion: number | null;
  costItems: CostItemInput[];
  pricingMode: string;
  marginPercent: number;
  overheadPercent: number;
  discountPercent: number;
  vatPercent: number;
  includeVat: boolean;
  currency: string;
  roleRates: string | null;
  /** Ошибка пересчёта (например, недопустимые сохранённые условия). */
  error: string | null;
}

/** Канонический JSON: ключи по алфавиту, чтобы порядок полей не влиял на хеш. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export function offerFingerprint(terms: OfferTerms, summary: CommercialSummary): string {
  const payload = {
    v: 1,
    pinnedSpecificationVersion: terms.pinnedSpecificationVersion,
    costItems: [...terms.costItems]
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
      .map((c) => ({
        id: c.id,
        kind: c.kind,
        description: c.description,
        quantity: c.quantity,
        unitCost: c.unitCost,
        currency: c.currency,
        exchangeRate: c.exchangeRate,
        exchangeRateDate: c.exchangeRateDate,
        exchangeRateSource: c.exchangeRateSource,
        specItemRef: c.specItemRef,
      })),
    pricingMode: terms.pricingMode,
    marginPercent: terms.marginPercent,
    overheadPercent: terms.overheadPercent,
    discountPercent: terms.discountPercent,
    vatPercent: terms.vatPercent,
    includeVat: terms.includeVat,
    currency: terms.currency,
    roleRates: terms.roleRates,
    knownPriceExVat: summary.total.priceExVat,
    knownCost: summary.total.cost,
    problems: summary.supply?.problems ?? [],
    error: terms.error,
  };
  return createHash('sha256').update(canonical(payload)).digest('hex');
}
