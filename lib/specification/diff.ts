import type { SpecificationCurrencyTotal, SpecificationItem, SpecificationSnapshot } from './types';
import { lineAmount, normalizeDecimal, subtractDecimal, summarizeSpecification } from './totals';

/** Fields compared between revisions, in display order. */
export const DIFF_FIELDS = [
  'kind',
  'disposition',
  'name',
  'vendor',
  'sku',
  'quantity',
  'unit',
  'configuration',
  'licensing',
  'term',
  'source',
  'rationale',
  'unitPrice',
  'currency',
  'confirmed',
] as const;
export type DiffField = (typeof DIFF_FIELDS)[number];

export const DIFF_FIELD_LABELS: Record<DiffField, string> = {
  kind: 'Тип',
  disposition: 'Назначение',
  name: 'Наименование',
  vendor: 'Вендор',
  sku: 'Артикул / редакция',
  quantity: 'Количество',
  unit: 'Единица',
  configuration: 'Характеристики',
  licensing: 'Лицензирование',
  term: 'Срок / условия',
  source: 'Источник',
  rationale: 'Основание',
  unitPrice: 'Цена за единицу',
  currency: 'Валюта',
  confirmed: 'Подтверждение',
};

export interface FieldChange {
  field: DiffField;
  before: string | null;
  after: string | null;
}

export interface DiffItem {
  id: string;
  name: string;
  quantity: string | null;
  unitPrice: string | null;
  currency: string;
  /** Exact quantity × price; null when unknown. */
  amount: string | null;
  changeReason: string;
}

export interface ChangedItem {
  id: string;
  name: string;
  changes: FieldChange[];
  /** Previous and new exact line amount when quantity, price or currency changed. */
  amount: { before: string | null; after: string | null } | null;
  changeReason: string;
  moved: boolean;
}

export interface TotalDiff {
  currency: string;
  before: SpecificationCurrencyTotal | null;
  after: SpecificationCurrencyTotal | null;
  /** Exact after − before of known amounts; meaningful only when `incomplete` is false. */
  delta: string;
  incomplete: boolean;
}

export interface SpecificationDiff {
  from: number;
  to: number;
  status: { before: SpecificationSnapshot['status']; after: SpecificationSnapshot['status'] };
  added: DiffItem[];
  removed: DiffItem[];
  changed: ChangedItem[];
  unchangedCount: number;
  totals: TotalDiff[];
}

function value(item: SpecificationItem, field: DiffField): string | null {
  const v = item[field];
  if (typeof v === 'boolean') return v ? 'да' : 'нет';
  return v ?? null;
}

function same(field: DiffField, a: string | null, b: string | null) {
  if ((field === 'quantity' || field === 'unitPrice') && a !== null && b !== null)
    return normalizeDecimal(a) === normalizeDecimal(b);
  return a === b;
}

function summary(item: SpecificationItem): DiffItem {
  return {
    id: item.id,
    name: item.name,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    currency: item.currency,
    amount: lineAmount(item),
    changeReason: item.changeReason ?? '',
  };
}

/**
 * Compares two revisions by stable row ID. Decimal values compare exactly
 * (1.50 equals 1.5), unknown values differ from 0, totals stay per currency.
 */
export function diffSpecifications(
  before: SpecificationSnapshot,
  after: SpecificationSnapshot,
): SpecificationDiff {
  const oldById = new Map(before.items.map((item, index) => [item.id, { item, index }]));
  const newIds = new Set(after.items.map((item) => item.id));
  const added: DiffItem[] = [];
  const changed: ChangedItem[] = [];
  let unchangedCount = 0;
  // Relative order among rows present in both revisions detects reordering.
  const commonOld = before.items.filter((i) => newIds.has(i.id)).map((i) => i.id);
  const commonNew = after.items.filter((i) => oldById.has(i.id)).map((i) => i.id);
  for (const item of after.items) {
    const previous = oldById.get(item.id)?.item;
    if (!previous) {
      added.push(summary(item));
      continue;
    }
    const changes: FieldChange[] = [];
    for (const field of DIFF_FIELDS) {
      const a = value(previous, field),
        b = value(item, field);
      if (!same(field, a, b)) changes.push({ field, before: a, after: b });
    }
    const moved = commonOld.indexOf(item.id) !== commonNew.indexOf(item.id);
    if (!changes.length && !moved) {
      unchangedCount++;
      continue;
    }
    const money = changes.some((c) => ['quantity', 'unitPrice', 'currency'].includes(c.field));
    changed.push({
      id: item.id,
      name: item.name || previous.name,
      changes,
      amount: money ? { before: lineAmount(previous), after: lineAmount(item) } : null,
      changeReason: item.changeReason ?? '',
      moved,
    });
  }
  const removed = before.items.filter((i) => !newIds.has(i.id)).map(summary);
  const beforeTotals = summarizeSpecification(before),
    afterTotals = summarizeSpecification(after);
  const currencies = [...new Set([...beforeTotals, ...afterTotals].map((t) => t.currency))].sort();
  const totals = currencies.map((currency) => {
    const b = beforeTotals.find((t) => t.currency === currency) ?? null,
      a = afterTotals.find((t) => t.currency === currency) ?? null;
    return {
      currency,
      before: b,
      after: a,
      delta: subtractDecimal(a?.total ?? '0', b?.total ?? '0'),
      incomplete: Boolean(a?.incomplete || b?.incomplete),
    };
  });
  return {
    from: before.version,
    to: after.version,
    status: { before: before.status, after: after.status },
    added,
    removed,
    changed,
    unchangedCount,
    totals,
  };
}
