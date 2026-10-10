import type { SpecificationItem } from './types';
import { SpecificationError } from './validation';

/** Columns a BOM file can map onto project specification fields (0-based indexes). */
export const BOM_FIELDS = [
  'name',
  'vendor',
  'sku',
  'kind',
  'quantity',
  'unit',
  'configuration',
  'licensing',
  'term',
  'unitPrice',
  'currency',
  'source',
  'rationale',
] as const;
export type BomField = (typeof BOM_FIELDS)[number];

export interface BomProfile {
  sheet: string;
  headerRow: number;
  startRow: number;
  endRow: number | null;
  delimiter: ',' | ';' | '\t';
  decimalSeparator: '.' | ',';
  currency: string;
  kind: SpecificationItem['kind'];
  mapping: Partial<Record<BomField, number>>;
}

export interface BomRow {
  id: string;
  sheet: string;
  rowNumber: number;
  raw: string[];
  item: SpecificationItem | null;
  errors: string[];
}

export interface BomPreview {
  filename: string;
  sheets: string[];
  headers: string[];
  profile: BomProfile;
  rows: BomRow[];
}

/**
 * Builds the next draft from selected valid preview rows. Rows with errors or
 * unknown IDs are rejected rather than silently skipped.
 */
export function mergeBomRows<T extends { items: SpecificationItem[] }>(
  current: T & { status: string },
  preview: Pick<BomPreview, 'rows'>,
  selectedIds: string[],
  mode: 'append' | 'replace' = 'append',
) {
  if (!selectedIds.length) throw new SpecificationError('Выберите строки для импорта');
  const byId = new Map(preview.rows.map((row) => [row.id, row]));
  const imported = selectedIds.map((id) => {
    const row = byId.get(id);
    if (!row) throw new SpecificationError(`Строка ${id} отсутствует в предпросмотре`);
    if (row.errors.length || !row.item)
      throw new SpecificationError(`Строка ${row.rowNumber} содержит ошибки и не импортируется`);
    return row.item;
  });
  return {
    ...current,
    status: 'draft' as const,
    items: mode === 'replace' ? imported : [...current.items, ...imported],
  };
}
