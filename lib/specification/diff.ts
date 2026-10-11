import type { SpecificationCurrencyTotal, SpecificationItem, SpecificationSnapshot } from './types';
import {
  isBundleComponent,
  lineAmount as rawLineAmount,
  normalizeDecimal,
  subtractDecimal,
  summarizeSpecification,
} from './totals';
import { requirementBasisText } from './requirements';

/** A bundle component has no amount of its own (totals rule 3a): the bundle row carries it. */
const lineAmount = (item: SpecificationItem) =>
  isBundleComponent(item) ? null : rawLineAmount(item);

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
  'includedIn',
  'requirementIds',
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
  includedIn: 'Входит в комплект (ID строки)',
  requirementIds: 'Требования (обоснование)',
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
  /** Exact quantity × price; null when unknown or for a bundle component. */
  amount: string | null;
  changeReason: string;
  /** Component of a bundle row: listed for composition, not summed. */
  bundleComponent?: boolean;
}

export interface ChangedItem {
  id: string;
  name: string;
  changes: FieldChange[];
  /** Previous and new exact line amount when quantity, price or currency changed. */
  amount: { before: string | null; after: string | null } | null;
  changeReason: string;
  moved: boolean;
  /** Present when the row is a bundle component in either revision (no own amount there). */
  bundleComponent?: { before: boolean; after: boolean };
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
  if (field === 'requirementIds') return requirementBasisText(item) || null;
  const v = item[field];
  if (typeof v === 'boolean') return v ? 'да' : 'нет';
  return v ?? null;
}

/** Связи с требованиями сравниваются как множество ID: порядок и коды не меняют связь. */
function sameField(field: DiffField, before: SpecificationItem, after: SpecificationItem) {
  if (field === 'requirementIds') {
    const ids = (item: SpecificationItem) => [...(item.requirementIds ?? [])].sort().join('\n');
    return ids(before) === ids(after);
  }
  return same(field, value(before, field), value(after, field));
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
    ...(isBundleComponent(item) ? { bundleComponent: true } : {}),
  };
}

/**
 * Rows present in both revisions keep their place when they belong to the longest
 * subsequence already in the old relative order (LIS over old indexes); only the
 * remaining rows were actually moved. O(n log n).
 */
export function movedIds(oldIndexes: number[], ids: string[]): Set<string> {
  const tails: number[] = []; // positions in oldIndexes ending the best run of each length
  const previous: number[] = new Array(oldIndexes.length).fill(-1);
  for (let i = 0; i < oldIndexes.length; i++) {
    let lo = 0,
      hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (oldIndexes[tails[mid]] < oldIndexes[i]) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) previous[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const kept = new Set<number>();
  for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = previous[i]) kept.add(i);
  return new Set(ids.filter((_, i) => !kept.has(i)));
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
  const moved = movedIds(
    after.items.filter((i) => oldById.has(i.id)).map((i) => oldById.get(i.id)!.index),
    after.items.filter((i) => oldById.has(i.id)).map((i) => i.id),
  );
  for (const item of after.items) {
    const previous = oldById.get(item.id)?.item;
    if (!previous) {
      added.push(summary(item));
      continue;
    }
    const changes: FieldChange[] = [];
    for (const field of DIFF_FIELDS) {
      if (!sameField(field, previous, item))
        changes.push({ field, before: value(previous, field), after: value(item, field) });
    }
    const isMoved = moved.has(item.id);
    if (!changes.length && !isMoved) {
      unchangedCount++;
      continue;
    }
    const money = changes.some((c) =>
      ['quantity', 'unitPrice', 'currency', 'includedIn'].includes(c.field),
    );
    changed.push({
      id: item.id,
      name: item.name || previous.name,
      changes,
      amount: money ? { before: lineAmount(previous), after: lineAmount(item) } : null,
      // A note inherited unchanged from the base revision explains an older edit.
      changeReason:
        (item.changeReason ?? '') !== (previous.changeReason ?? '')
          ? (item.changeReason ?? '')
          : '',
      moved: isMoved,
      ...(isBundleComponent(previous) || isBundleComponent(item)
        ? {
            bundleComponent: {
              before: isBundleComponent(previous),
              after: isBundleComponent(item),
            },
          }
        : {}),
    });
  }
  // A removed row's note belongs to the edit that produced the old revision.
  const removed = before.items
    .filter((i) => !newIds.has(i.id))
    .map((i) => ({ ...summary(i), changeReason: '' }));
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

/** True when any compared field differs (decimals exactly, unknown ≠ 0). */
export function rowChanged(before: SpecificationItem, after: SpecificationItem) {
  return DIFF_FIELDS.some((field) => !sameField(field, before, after));
}

/**
 * A change note describes the edit made in one revision. Rows that are unchanged
 * relative to the base revision drop their note, so it does not carry over into
 * later editions; edited and new rows keep the note supplied with this save.
 */
export function clearStaleChangeReasons(
  base: SpecificationSnapshot | null,
  next: SpecificationSnapshot,
): SpecificationSnapshot {
  const previous = new Map((base?.items ?? []).map((item) => [item.id, item]));
  return {
    ...next,
    items: next.items.map((item) => {
      const old = previous.get(item.id);
      if (!item.changeReason || !old || rowChanged(old, item)) return item;
      const { changeReason: _stale, ...rest } = item;
      void _stale;
      return rest;
    }),
  };
}
