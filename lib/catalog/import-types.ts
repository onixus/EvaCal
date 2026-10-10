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
  'priceDate',
  'validUntil',
  'region',
  'kind',
  'manufacturer',
  'taxRate',
  'discountCategory',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
/** Russian labels shared by the UI, saved-profile reports and row errors. */
export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  name: 'Наименование',
  sku: 'Партномер',
  edition: 'Редакция',
  description: 'Описание',
  unit: 'Единица',
  licensing: 'Лицензирование',
  unitPrice: 'Цена',
  currency: 'Валюта',
  terms: 'Условия / срок',
  priceDate: 'Дата цены',
  validUntil: 'Действует до',
  region: 'Регион',
  kind: 'Тип позиции',
  manufacturer: 'Производитель',
  taxRate: 'НДС, %',
  discountCategory: 'Скидочная категория',
};
/** A source column copied into product attributes[] as {name, value, unit}. */
export interface ImportAttributeColumn {
  column: number;
  name: string;
  unit: string;
}
export interface ImportProfile {
  vendorId: string;
  sheet: string;
  headerRow: number;
  startRow: number;
  endRow: number | null;
  delimiter: ',' | ';' | '\t';
  decimalSeparator: '.' | ',';
  currency: string;
  /** Default kind; a mapped `kind` column overrides it per row. */
  kind: ProductInput['kind'];
  mapping: Partial<Record<ImportField, number>>;
  /** Absent in drafts saved before characteristic columns existed. */
  attributes?: ImportAttributeColumn[];
}
/** Result of applying a saved profile to a concrete file by header names. */
export interface ProfileApplication {
  profileId: string;
  profileRevision: number;
  name: string;
  /** Header-name mismatches; the affected mapping is left empty for explicit review. */
  mismatches: string[];
  /** Columns found at a different position than in the profile's source file. */
  moved: string[];
  /** Headers absent from the file the profile was saved from. */
  added: string[];
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
  /** Present when the analysis used a saved reusable profile. */
  profileApplication?: ProfileApplication | null;
  rows: ImportRow[];
}
