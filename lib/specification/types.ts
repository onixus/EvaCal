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
}

export interface SpecificationSnapshot {
  version: number;
  status: 'draft' | 'confirmed';
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
