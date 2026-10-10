import {
  GPL_UPDATE_FIELDS,
  type GplUpdateField,
  type GplUpdatePreview,
  type GplUpdateSelection,
  type GplCurrencyTotal,
} from './gpl-update-types';
import type { SpecificationSnapshot } from './types';
import { parseSpecification, SpecificationError } from './validation';

export function equalGplValue(field: GplUpdateField, a: string | null, b: string | null) {
  const decimal = (value: string | null) =>
    value === null
      ? null
      : value.includes('.')
        ? value.replace(/0+$/, '').replace(/\.$/, '')
        : value;
  return field === 'unitPrice' ? decimal(a) === decimal(b) : a === b;
}
export function parseGplSelections(input: unknown): GplUpdateSelection[] {
  if (!Array.isArray(input) || input.length > 500)
    throw new SpecificationError('Выберите до 500 позиций');
  const seen = new Set<string>();
  return input.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new SpecificationError('Некорректный выбор');
    const d = raw as Record<string, unknown>;
    if (
      typeof d.itemId !== 'string' ||
      !d.itemId ||
      d.itemId.length > 100 ||
      seen.has(d.itemId) ||
      !Array.isArray(d.fields) ||
      !d.fields.length ||
      d.fields.length > GPL_UPDATE_FIELDS.length ||
      new Set(d.fields).size !== d.fields.length ||
      d.fields.some((f) => !(GPL_UPDATE_FIELDS as readonly unknown[]).includes(f)) ||
      (d.allowPriceOverride !== undefined && typeof d.allowPriceOverride !== 'boolean')
    )
      throw new SpecificationError('Некорректные или повторные поля выбора');
    seen.add(d.itemId);
    return {
      itemId: d.itemId,
      fields: d.fields as GplUpdateField[],
      ...(d.allowPriceOverride === undefined
        ? {}
        : { allowPriceOverride: d.allowPriceOverride as boolean }),
    };
  });
}
export function applyGplUpdateSelections(
  snapshot: SpecificationSnapshot,
  preview: GplUpdatePreview,
  input: unknown,
): SpecificationSnapshot {
  const selections = parseGplSelections(input),
    selected = new Map(selections.map((s) => [s.itemId, s]));
  for (const selection of selections) {
    const row = preview.rows.find((r) => r.itemId === selection.itemId);
    if (!row || row.status !== 'matched' || !row.targetSource)
      throw new SpecificationError('Выбрана несопоставленная позиция');
    if (selection.fields.some((f) => !row.changes.some((c) => c.field === f)))
      throw new SpecificationError('Выбрано неизвестное или неизмененное поле');
    const price = selection.fields.includes('unitPrice'),
      currency = selection.fields.includes('currency');
    if (price !== currency) throw new SpecificationError('Цена и валюта выбираются вместе');
    if ((price || currency) && row.manualPrice && selection.allowPriceOverride !== true)
      throw new SpecificationError('Ручная цена: требуется явное разрешение замены');
  }
  const items = snapshot.items.map((item) => {
    const selection = selected.get(item.id);
    if (!selection) return item;
    const row = preview.rows.find((r) => r.itemId === item.id)!;
    const next = structuredClone(item);
    if (!next.origin) throw new SpecificationError('Отсутствует происхождение позиции');
    for (const field of selection.fields) {
      const change = row.changes.find((c) => c.field === field)!;
      if (!equalGplValue(field, item[field], change.before))
        throw new SpecificationError('Позиция изменилась после предпросмотра', 409);
      // parseSpecification below validates the complete resulting field types.
      Object.assign(next, { [field]: change.after });
      Object.assign(next.origin.baseline, { [field]: change.after });
      next.origin.fieldSources = {
        ...next.origin.fieldSources,
        [field]: structuredClone(row.targetSource!),
      };
    }
    if (selection.fields.includes('unitPrice')) next.priceOverride = false;
    next.confirmed = false;
    return next;
  });
  return parseSpecification({
    ...snapshot,
    status: selections.length ? 'draft' : snapshot.status,
    items,
  });
}
const SCALE = BigInt(1_000_000);
function scaled(value: string): bigint {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, '0'));
}
export function summarizeSpecification(snapshot: SpecificationSnapshot): GplCurrencyTotal[] {
  const totals = new Map<string, { amount: bigint; unknownCount: number; includedCount: number }>();
  for (const item of snapshot.items) {
    if (item.disposition !== 'supply') continue;
    const sum = totals.get(item.currency) ?? {
      amount: BigInt(0),
      unknownCount: 0,
      includedCount: 0,
    };
    sum.includedCount++;
    if (item.quantity === null || item.unitPrice === null || !item.currency) sum.unknownCount++;
    else sum.amount += scaled(item.quantity) * scaled(item.unitPrice);
    totals.set(item.currency, sum);
  }
  return [...totals.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([currency, sum]) => {
      const denominator = SCALE * SCALE,
        fraction = (sum.amount % denominator).toString().padStart(12, '0').replace(/0+$/, '');
      return {
        currency,
        total: `${sum.amount / denominator}${fraction ? '.' + fraction : ''}`,
        unknownCount: sum.unknownCount,
        includedCount: sum.includedCount,
      };
    });
}
