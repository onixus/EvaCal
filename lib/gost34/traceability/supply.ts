import type { SpecificationItem } from '../../specification/types';
import { DISPOSITION_LABELS } from '../../specification/sections';

/**
 * #101 этап 3: трассировка «требование → позиции спецификации». Связь задается в
 * строке спецификации (requirementIds); матрица прослеживаемости показывает, какими
 * позициями обеспечено требование.
 */
export interface RequirementSupplyItem {
  itemId: string;
  name: string;
  vendor: string;
  sku: string;
  quantity: string | null;
  unit: string;
  disposition: SpecificationItem['disposition'];
}

/** ID требования → связанные позиции (в порядке строк спецификации). */
export function buildRequirementSupplyIndex(
  items: SpecificationItem[] | undefined,
): Map<string, RequirementSupplyItem[]> {
  const index = new Map<string, RequirementSupplyItem[]>();
  for (const item of Array.isArray(items) ? items : []) {
    if (!Array.isArray(item?.requirementIds)) continue;
    for (const requirementId of item.requirementIds) {
      const list = index.get(requirementId) ?? [];
      list.push({
        itemId: item.id,
        name: item.name,
        vendor: item.vendor,
        sku: item.sku,
        quantity: item.quantity,
        unit: item.unit,
        disposition: item.disposition,
      });
      index.set(requirementId, list);
    }
  }
  return index;
}

/** «Сервер X (Vendor / SKU), 2 шт.; …» с пометкой не поставляемых позиций. */
export function supplyItemsText(items: RequirementSupplyItem[]): string {
  return items
    .map((item) => {
      const identity = [item.vendor, item.sku].filter(Boolean).join(' / ');
      const quantity =
        item.quantity === null ? 'кол-во неизвестно' : `${item.quantity} ${item.unit}`;
      const disposition =
        item.disposition === 'supply' ? '' : ` — ${DISPOSITION_LABELS[item.disposition]}`;
      return `${item.name || item.itemId}${identity ? ` (${identity})` : ''}, ${quantity}${disposition}`;
    })
    .join('; ');
}
