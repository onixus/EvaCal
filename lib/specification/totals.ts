import type { SpecificationCurrencyTotal, SpecificationItem, SpecificationSnapshot } from './types';

/**
 * Exact specification arithmetic (no floating point, no FX conversion).
 *
 * Rounding rules:
 * 1. Quantity and unit price are stored exactly as decimal strings (≤ 6 fractional digits).
 * 2. A line amount is quantity × unit price, computed exactly (≤ 12 fractional digits).
 * 3. A currency total is the exact sum of line amounts of `supply` rows in that currency.
 *    Rows with `existing`/`alternative` disposition are not part of the supply total.
 * 3a. Bundles: a component row (`includedIn` → a `bundle` row) is never summed — the
 *    bundle row carries the price of the whole composition, so the hardware complex
 *    and the software included in it are not counted twice. A component's own price
 *    is informational. An unknown bundle price makes the total incomplete even when
 *    the component prices are known.
 * 4. Unknown quantity, unknown price or a missing currency is never treated as 0: the row
 *    is counted in `unknownCount` and the total is flagged `incomplete` (a lower bound).
 *    A price of 0 is a free item and keeps the total complete.
 * 5. Rounding happens only for presentation (panel, SPEC DOCX): half-up to 2 fractional
 *    digits via {@link roundDecimal}. API, diff and XLSX keep the exact value.
 */
export const TOTAL_DISPLAY_PLACES = 2;

const SCALE_DIGITS = 12;
const SCALE = BigInt(10) ** BigInt(SCALE_DIGITS);

/** Parse a (possibly signed) decimal string into an integer scaled by 10^12. */
export function toScaled(value: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,12}))?$/.exec(value);
  if (!match) throw new Error(`Некорректное десятичное число: ${value}`);
  const magnitude = BigInt(match[2]) * SCALE + BigInt((match[3] ?? '').padEnd(SCALE_DIGITS, '0'));
  return match[1] ? -magnitude : magnitude;
}

/** Format an integer scaled by 10^12 as the shortest exact decimal string. */
export function fromScaled(value: bigint): string {
  const negative = value < BigInt(0);
  const abs = negative ? -value : value;
  const fraction = (abs % SCALE).toString().padStart(SCALE_DIGITS, '0').replace(/0+$/, '');
  const text = `${abs / SCALE}${fraction ? '.' + fraction : ''}`;
  return negative && text !== '0' ? `-${text}` : text;
}

/** Canonical form of a decimal string (drops trailing fractional zeros). */
export function normalizeDecimal(value: string): string {
  return fromScaled(toScaled(value));
}

export function subtractDecimal(a: string, b: string): string {
  return fromScaled(toScaled(a) - toScaled(b));
}

/** Half-up rounding (away from zero for negatives) to `places` fractional digits. */
export function roundDecimal(value: string, places = TOTAL_DISPLAY_PLACES): string {
  const scaled = toScaled(value);
  const negative = scaled < BigInt(0);
  const abs = negative ? -scaled : scaled;
  const unit = BigInt(10) ** BigInt(SCALE_DIGITS - places);
  const rounded = ((abs + unit / BigInt(2)) / unit) * unit;
  const whole = (rounded / SCALE).toString();
  const fraction = (rounded % SCALE).toString().padStart(SCALE_DIGITS, '0').slice(0, places);
  const text = places ? `${whole}.${fraction}` : whole;
  return negative && rounded !== BigInt(0) ? `-${text}` : text;
}

/** Exact quantity × unit price; null when quantity or price is unknown. */
export function lineAmount(item: Pick<SpecificationItem, 'quantity' | 'unitPrice'>) {
  if (item.quantity === null || item.unitPrice === null) return null;
  // Both factors have ≤ 6 fractional digits, so the product fits the 10^12 scale exactly.
  const micro = (v: string) => toScaled(v) / BigInt(1_000_000);
  return fromScaled(micro(item.quantity) * micro(item.unitPrice));
}

/** Component of a bundle row: listed for composition, excluded from totals (rule 3a). */
export function isBundleComponent(item: Pick<SpecificationItem, 'includedIn'>) {
  return Boolean(item.includedIn);
}

/** Per-currency exact totals of supplied rows, sorted by currency code. */
export function summarizeSpecification(
  snapshot: Pick<SpecificationSnapshot, 'items'>,
): SpecificationCurrencyTotal[] {
  const totals = new Map<string, { amount: bigint; unknownCount: number; includedCount: number }>();
  for (const item of snapshot.items) {
    if (item.disposition !== 'supply' || isBundleComponent(item)) continue;
    const sum = totals.get(item.currency) ?? {
      amount: BigInt(0),
      unknownCount: 0,
      includedCount: 0,
    };
    sum.includedCount++;
    const amount = item.currency ? lineAmount(item) : null;
    if (amount === null) sum.unknownCount++;
    else sum.amount += toScaled(amount);
    totals.set(item.currency, sum);
  }
  return [...totals.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([currency, sum]) => ({
      currency,
      total: fromScaled(sum.amount),
      unknownCount: sum.unknownCount,
      includedCount: sum.includedCount,
      incomplete: sum.unknownCount > 0,
    }));
}

/** Human-readable total: rounded value, exact value when rounding changed it, completeness. */
export function describeTotal(total: SpecificationCurrencyTotal): string {
  const rounded = roundDecimal(total.total);
  const exact = normalizeDecimal(rounded) === total.total ? '' : ` (точно: ${total.total})`;
  const currency = total.currency || 'без валюты';
  const suffix = total.incomplete
    ? ` — неполная сумма: неизвестна стоимость ${total.unknownCount} из ${total.includedCount} поз.`
    : ` — ${total.includedCount} поз.`;
  return `${rounded}${exact} ${currency}${suffix}`;
}
