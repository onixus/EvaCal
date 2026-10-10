import type { SpecificationItem } from '../specification/types';
export const CATALOG_ROLES = ['admin', 'architect', 'presale'];
export interface Vendor {
  id: string;
  name: string;
  revision: number;
  archived: boolean;
}
export interface Attribute {
  name: string;
  value: string;
  unit: string;
}
export interface ProductInput {
  vendorId: string;
  name: string;
  sku: string;
  edition: string;
  kind: SpecificationItem['kind'];
  unit: string;
  licensing: string;
  attributes: Attribute[];
}
export interface OfferInput {
  source: string;
  unitPrice: string | null;
  currency: string;
  region: string;
  terms: string;
  priceDate: string | null;
  validUntil: string | null;
  /** VAT/tax rate in percent as an exact decimal string; null is unknown. Optional for legacy rows. */
  taxRate?: string | null;
  /** Vendor discount category/group as given in the source; empty is not set. */
  discountCategory?: string;
}
export const OFFER_CONFIRMATION = ['unconfirmed', 'confirmed'] as const;
export type OfferConfirmation = (typeof OFFER_CONFIRMATION)[number];
export interface OfferProductSnapshot extends ProductInput {
  id: string;
  revision: number;
  vendor: { id: string; name: string; revision: number };
}
export interface ImportProvenance {
  importId: string;
  importRevision: number;
  checksum: string;
  filename: string;
  sheet: string;
  rowNumber: number;
  uploadedBy: string;
  confirmedBy: string;
}
export interface Offer extends OfferInput {
  importProvenance?: ImportProvenance | null;
  productSnapshot: OfferProductSnapshot | null;
  productRevision: number;
  /** Imported offers are confirmed only by the explicit GPL confirmation; manual ones by a separate action. */
  confirmationStatus: OfferConfirmation;
  confirmedBy: string | null;
  confirmedAt: string | null;
  id: string;
  createdAt: string;
  createdBy: string;
}
export interface Product extends ProductInput {
  id: string;
  revision: number;
  archived: boolean;
  vendor: Vendor;
  offers: Offer[];
}
export interface Catalog {
  vendors: Vendor[];
  products: Product[];
}
