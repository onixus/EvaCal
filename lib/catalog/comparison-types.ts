import type { ImportRow } from './import-types';

export type ComparisonStatus = 'added' | 'missing' | 'changed' | 'unchanged' | 'ambiguous';
export type ComparisonField =
  | 'name'
  | 'kind'
  | 'unit'
  | 'licensing'
  | 'attributes'
  | 'unitPrice'
  | 'currency'
  | 'region'
  | 'terms'
  | 'priceDate'
  | 'validUntil';
export interface ComparisonSource {
  id: string;
  filename: string;
  checksum: string;
  revision: number;
  vendorId: string;
  createdAt: string;
  confirmedAt: string | null;
  sheet: string;
  headerRow: number;
  startRow: number;
  endRow: number | null;
  acceptedCount: number;
  excludedCount: number;
  errorCount: number;
}
export interface ComparisonRow {
  key: string;
  sku: string;
  edition: string;
  status: ComparisonStatus;
  before: ImportRow[];
  after: ImportRow[];
  changes: Array<{ field: ComparisonField; before: string | null; after: string | null }>;
}
export interface ImportComparison {
  before: ComparisonSource;
  after: ComparisonSource;
  rows: ComparisonRow[];
  counts: Record<ComparisonStatus, number>;
  warnings: string[];
}
