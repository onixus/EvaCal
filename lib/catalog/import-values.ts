// Client-safe value parsers shared by the GPL importer and the manual catalog
// forms, so both accept exactly the same formats and produce the same errors.
import { SpecificationError } from '../specification/validation';
import { ITEM_KINDS } from '../specification/types';
import { isTaxRate } from './validation';
import type { ProductInput } from './types';

const KIND_ALIASES: Record<string, (typeof ITEM_KINDS)[number]> = {
  оборудование: 'hardware',
  железо: 'hardware',
  по: 'software',
  'программное обеспечение': 'software',
  лицензия: 'license',
  поддержка: 'support',
  'техническая поддержка': 'support',
  услуга: 'service',
  услуги: 'service',
  работы: 'service',
  другое: 'other',
  прочее: 'other',
};
/** Per-row kind: code (hardware…) or Russian label. */
export function parseImportKind(value: string): (typeof ITEM_KINDS)[number] {
  const key = value.trim().toLowerCase().replace(/\s+/g, ' ');
  if ((ITEM_KINDS as readonly string[]).includes(key)) return key as (typeof ITEM_KINDS)[number];
  const kind = KIND_ALIASES[key];
  if (!kind)
    throw new SpecificationError(
      `Тип позиции: «${value}» не распознан (оборудование, ПО, лицензия, поддержка, услуга, другое)`,
    );
  return kind;
}
/** Text dates: ГГГГ-ММ-ДД or ДД.ММ.ГГГГ. Empty means unknown — never "today". */
export function parseImportDate(value: string, label: string): string | null {
  const v = value.trim();
  if (!v) return null;
  let iso = '';
  const ru = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) iso = v;
  else if (ru) iso = `${ru[3]}-${ru[2].padStart(2, '0')}-${ru[1].padStart(2, '0')}`;
  if (!iso || !Number.isFinite(Date.parse(iso)) || new Date(iso).toISOString().slice(0, 10) !== iso)
    throw new SpecificationError(
      `${label}: «${v}» — ожидается дата ГГГГ-ММ-ДД или ДД.ММ.ГГГГ; пусто — неизвестно`,
    );
  return iso;
}
export interface ParsedTax {
  /** Percent as an exact decimal string; null is unknown (never 0). */
  taxRate: string | null;
  /** Explicit «Без НДС»: rate 0 by exemption, distinct from a 0 % rate. */
  taxExempt: boolean;
}
const EXEMPT =
  /^(без\s*ндс|ндс\s*не\s*облагается|не\s*облагается(\s*ндс)?|освобожден[оа]?\s*от\s*ндс)\.?$/i;
/**
 * Tax percent: «20», «20%», «20,5 %», «0», «Без НДС». A bare number in (0; 1]
 * is ambiguous (0,2 % or a 20 % fraction?) and is rejected unless marked with %.
 */
export function parseImportTaxRate(value: string, decimalSeparator: '.' | ','): ParsedTax {
  const v = value.trim();
  if (!v) return { taxRate: null, taxExempt: false };
  if (EXEMPT.test(v.replace(/\s+/g, ' '))) return { taxRate: '0', taxExempt: true };
  const compact = v.replace(/[\s ]/g, '');
  const explicitPercent = compact.endsWith('%');
  const normalized = compact.replace(/%$/, '').replace(decimalSeparator, '.');
  const match = /^(\d{1,3})(?:\.(\d{1,4}))?$/.exec(normalized);
  const result = match
    ? `${String(Number(match[1]))}${match[2] && /[1-9]/.test(match[2]) ? `.${match[2].replace(/0+$/, '')}` : ''}`
    : '';
  if (!isTaxRate(result))
    throw new SpecificationError(
      `НДС: «${v}» — ожидается процент 0–100, например 20 или 20%, либо «Без НДС»`,
    );
  if (!explicitPercent && Number(result) > 0 && Number(result) <= 1)
    throw new SpecificationError(
      `НДС: «${v}» — неоднозначно (${result} % или доля ${Number(result) * 100} %?): укажите процент, например 20 или 20%`,
    );
  return { taxRate: result, taxExempt: false };
}
/** Manual forms: either decimal separator is accepted. */
export function parseTaxInput(value: string | null | undefined): ParsedTax {
  return parseImportTaxRate(String(value ?? '').replace(',', '.'), '.');
}
/** Human-readable tax value for UI. */
export function taxLabel(offer: { taxRate?: string | null; taxExempt?: boolean }): string {
  if (offer.taxExempt) return 'Без НДС';
  return offer.taxRate == null ? 'НДС неизвестен' : `НДС ${offer.taxRate}%`;
}

export interface TechnicalChange {
  field: 'name' | 'kind' | 'unit' | 'licensing' | 'attributes';
  before: string;
  after: string;
}
const attributesText = (attributes: ProductInput['attributes']) =>
  [...attributes]
    .map((a) => `${a.name}: ${a.value}${a.unit ? ` ${a.unit}` : ''}`)
    .sort()
    .join('; ');
/** Differences of the technical identity of an existing product and an imported row. */
export function technicalDiff(before: ProductInput, after: ProductInput): TechnicalChange[] {
  const changes: TechnicalChange[] = [];
  for (const field of ['name', 'kind', 'unit', 'licensing'] as const)
    if (before[field] !== after[field])
      changes.push({ field, before: before[field], after: after[field] });
  const a = attributesText(before.attributes),
    b = attributesText(after.attributes);
  if (a !== b) changes.push({ field: 'attributes', before: a, after: b });
  return changes;
}
