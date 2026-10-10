import type { SpecificationCatalogOrigin } from './gpl-update-types';
export const ITEM_KINDS = [
  'hardware',
  'software',
  'license',
  'support',
  'service',
  'other',
] as const;
export const ITEM_DISPOSITIONS = ['supply', 'existing', 'alternative'] as const;

export interface SpecificationItem {
  id: string;
  origin?: SpecificationCatalogOrigin;
  priceOverride?: boolean;
  kind: (typeof ITEM_KINDS)[number];
  disposition: (typeof ITEM_DISPOSITIONS)[number];
  name: string;
  vendor: string;
  sku: string;
  quantity: string | null;
  unit: string;
  configuration: string;
  licensing: string;
  term: string;
  source: string;
  rationale: string;
  confirmed: boolean;
  /** Decimal strings preserve source precision; null means unknown, not free. */
  unitPrice: string | null;
  currency: string;
  /** Optional note explaining why this row changed in the revision (shown in diff). */
  changeReason?: string;
}

/**
 * Lifecycle: draft → review → confirmed → released. `released` is never sent by
 * editors: it is assigned when a GOST package is issued from a confirmed revision.
 * Older snapshots only contain draft/confirmed and remain valid.
 */
export const SPECIFICATION_STATUSES = ['draft', 'review', 'confirmed', 'released'] as const;
export type SpecificationStatus = (typeof SPECIFICATION_STATUSES)[number];
/** Statuses that pass the final SPEC gate (released is a confirmed revision issued in a package). */
export const FINAL_SPECIFICATION_STATUSES: readonly SpecificationStatus[] = [
  'confirmed',
  'released',
];

export interface SpecificationCurrencyTotal {
  currency: string;
  /** Exact decimal sum of quantity × unit price for known rows (no rounding). */
  total: string;
  /** Rows of this currency whose quantity, price or currency is unknown. */
  unknownCount: number;
  includedCount: number;
  /** True when at least one included row has an unknown amount: the total is a lower bound. */
  incomplete: boolean;
}

export interface SpecificationSnapshot {
  version: number;
  status: SpecificationStatus;
  /** Explicitly confirmed empty supply is valid, unlike missing data. */
  emptySupplyReason: string;
  items: SpecificationItem[];
}

export interface SavedSpecification {
  id: string;
  snapshot: SpecificationSnapshot;
  createdAt: string;
  createdBy: string;
}
