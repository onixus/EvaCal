import type { ProductInput, OfferInput } from './types';
export const IMPORT_FIELDS = [
  'name',
  'sku',
  'edition',
  'description',
  'unit',
  'licensing',
  'unitPrice',
  'currency',
  'terms',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export interface ImportProfile {
  vendorId: string;
  sheet: string;
  headerRow: number;
  startRow: number;
  endRow: number | null;
  delimiter: ',' | ';' | '\t';
  decimalSeparator: '.' | ',';
  currency: string;
  kind: ProductInput['kind'];
  mapping: Partial<Record<ImportField, number>>;
}
export interface ImportRow {
  id: string;
  sheet: string;
  rowNumber: number;
  raw: string[];
  normalized: { product: ProductInput; offer: OfferInput } | null;
  errors: string[];
  status: 'ready' | 'error' | 'accepted' | 'excluded';
}
export interface ImportDraft {
  id: string;
  revision: number;
  revisionCreatedBy: string;
  revisionCreatedAt: string;
  status: 'draft' | 'confirmed';
  filename: string;
  checksum: string;
  createdBy: string;
  createdAt: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
  sheets: string[];
  headers: string[];
  profile: ImportProfile;
  rows: ImportRow[];
}
