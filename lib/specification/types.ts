import type { SpecificationCatalogOrigin } from './gpl-update-types';
import type { EvidenceSnapshot } from '../catalog/compliance';
export const ITEM_KINDS = [
  'hardware',
  'software',
  'license',
  'support',
  'service',
  'subscription',
  'bundle',
  'other',
] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
/** Single source of Russian labels for item kinds (forms, XLSX, diff views). */
export const ITEM_KIND_LABELS: Record<ItemKind, string> = {
  hardware: 'Оборудование',
  software: 'ПО',
  license: 'Лицензия',
  support: 'Поддержка',
  service: 'Услуга',
  subscription: 'Подписка',
  bundle: 'Комплект',
  other: 'Другое',
};
/** Kinds that need a licensing model or right of use before the final gate. */
export const LICENSED_KINDS: readonly ItemKind[] = ['software', 'license', 'subscription'];
export const ITEM_DISPOSITIONS = ['supply', 'existing', 'alternative'] as const;

/**
 * Связь строки с технической потребностью из прогона сайзинга (#101 WP5).
 * Строка остаётся закупаемой позицией (SKU); связь лишь фиксирует, какую метрику
 * она покрывает. requiredQuantity — значение метрики в прогоне на момент связи.
 */
export interface SpecificationSizingRef {
  runId: string;
  metric: string;
  /** Сценарий прогона; по умолчанию base. */
  scenario?: string;
  /** Значение метрики (десятичная строка) в связанном прогоне. */
  requiredQuantity: string;
  /** Сколько единиц метрики покрывает одна единица позиции; по умолчанию 1. */
  unitCapacity?: string;
}

export interface SpecificationItem {
  id: string;
  sizingRef?: SpecificationSizingRef;
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
  /**
   * #101 §3 price split (all optional exact decimal strings, absent — not set).
   * `unitPrice` keeps its meaning: the list/offer price per unit in `currency`
   * (GPL or manual) — supply totals of the specification are qty × unitPrice.
   * In the КП the customer price per unit is `salePrice` when set, otherwise
   * `unitPrice`; `discountPercent` (0–100) reduces it per line; `vatRate`
   * (percent, 0–100) overrides the calculation VAT for the line;
   * `purchasePrice` is our cost per unit (absent — the line cost is unknown
   * unless a cost item is linked to the row).
   */
  purchasePrice?: string;
  salePrice?: string;
  discountPercent?: string;
  vatRate?: string;
  currency: string;
  /** Optional note explaining why this row changed in the revision (shown in diff). */
  changeReason?: string;
  /**
   * Optional ID of a `bundle` row of the same snapshot this row is a component of.
   * Components are listed for composition only: their amounts never enter totals,
   * the bundle row carries the price (see totals.ts, rule 3a).
   */
  includedIn?: string;
  /** Component quantity per one bundle (with `includedIn`); the editor derives quantity from it. */
  perBundle?: string;
  /**
   * Compliance evidence (registry entries, certificates) of the catalog product,
   * copied by the server when the row is added or confirmed; immutable in the revision.
   */
  evidence?: EvidenceSnapshot[];
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
  /** Прогоны сайзинга, на которые ссылаются строки редакции (заполняется при сохранении). */
  sizingRunIds?: string[];
  /**
   * #101 §3: курсы, по которым суммы редакции пересчитываются в валюту КП.
   * Хранятся в снимке вместе с датой и источником; исходные цены и валюты строк
   * не меняются. Без курса пары валют пересчёт не выполняется (сумма неполная).
   */
  exchangeRates?: SpecificationExchangeRate[];
}

export interface SpecificationExchangeRate {
  from: string;
  to: string;
  /** Exact decimal string, > 0, up to 8 fractional digits: 1 `from` = rate `to`. */
  rate: string;
  /** YYYY-MM-DD */
  date: string;
  source: string;
  /** ExchangeRate row the value was copied from, when taken from the registry. */
  rateId?: string;
}

export interface SavedSpecification {
  id: string;
  snapshot: SpecificationSnapshot;
  createdAt: string;
  createdBy: string;
}
