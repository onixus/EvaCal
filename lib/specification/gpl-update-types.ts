import type { SpecificationSnapshot } from './types';
export const GPL_UPDATE_FIELDS = [
  'name',
  'kind',
  'unit',
  'configuration',
  'licensing',
  'term',
  'source',
  'unitPrice',
  'currency',
] as const;
export type GplUpdateField = (typeof GPL_UPDATE_FIELDS)[number];
export interface SpecificationImportOrigin {
  importId: string;
  /** Confirmed snapshot revision (offer importProvenance revision + 1). */
  revision: number;
  checksum: string;
  sheet: string;
  rowNumber: number;
}
export type GplCopiedFields = Record<Exclude<GplUpdateField, 'unitPrice'>, string> & {
  unitPrice: string | null;
};
export interface SpecificationCatalogOrigin {
  vendorId: string;
  vendorName: string;
  productId: string;
  productRevision: number;
  offerId: string | null;
  sku: string;
  edition: string;
  import: SpecificationImportOrigin | null;
  /** Persisted copied values are descriptive; server verifies baseline from immutable sources. */
  baseline: GplCopiedFields;
  /** Source of a field after a selective update; absent means the original import. */
  fieldSources?: Partial<Record<GplUpdateField, SpecificationImportOrigin>>;
}
export interface GplUpdateSelection {
  itemId: string;
  fields: GplUpdateField[];
  allowPriceOverride?: boolean;
}
export interface GplUpdateRow {
  itemId: string;
  name: string;
  status: 'matched' | 'unlinked' | 'missing' | 'ambiguous' | 'invalid';
  reason: string;
  manualPrice: boolean;
  changes: Array<{
    field: GplUpdateField;
    before: string | null;
    after: string | null;
    manuallyEdited: boolean;
    defaultSelected: boolean;
  }>;
  targetSource: SpecificationImportOrigin | null;
}
export interface GplCurrencyTotal {
  currency: string;
  total: string;
  unknownCount: number;
  includedCount: number;
}
export interface GplUpdatePreview {
  version: number;
  target: { id: string; revision: number; checksum: string; filename: string; vendorId: string };
  rows: GplUpdateRow[];
  selections: GplUpdateSelection[];
  totals: { before: GplCurrencyTotal[]; after: GplCurrencyTotal[] };
  warnings: string[];
}
export interface GplUpdateRequest {
  action: 'preview' | 'apply';
  version: number;
  targetImportId: string;
  targetRevision: number;
  targetChecksum: string;
  selections: GplUpdateSelection[];
}
export type GplUpdatedSnapshot = SpecificationSnapshot;
