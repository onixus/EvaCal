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
}
export interface OfferProductSnapshot extends ProductInput {
  id: string;
  revision: number;
  vendor: { id: string; name: string; revision: number };
}
export interface Offer extends OfferInput {
  productSnapshot: OfferProductSnapshot | null;
  productRevision: number;
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
