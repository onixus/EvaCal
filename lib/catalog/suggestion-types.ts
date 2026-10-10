// Client-safe suggestion types and reviewer drafts (no Prisma imports).
import type { SpecificationItem } from '../specification/types';
import type { ProductInput, OfferInput } from './types';

export const SUGGESTION_STATUSES = ['pending', 'accepted', 'rejected'] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];
export interface CatalogSuggestion {
  id: string;
  calculationId: string;
  specificationVersion: number;
  itemSnapshot: SpecificationItem;
  status: SuggestionStatus;
  createdBy: string;
  createdAt: string;
  reviewer: string | null;
  reviewedAt: string | null;
  comment: string;
  createdProductId: string | null;
}
/** Prefilled catalog draft for the reviewer; nothing here is confirmed automatically. */
export function suggestionDrafts(
  s: Pick<CatalogSuggestion, 'itemSnapshot' | 'calculationId' | 'specificationVersion'>,
) {
  const item = s.itemSnapshot;
  const product: ProductInput = {
    vendorId: '',
    name: item.name,
    sku: item.sku,
    edition: '',
    kind: item.kind,
    unit: item.unit || 'шт.',
    licensing: item.licensing,
    attributes: [],
  };
  const offer: OfferInput | null =
    item.unitPrice === null
      ? null
      : {
          source:
            `Предложение из проекта ${s.calculationId}, ред. ${s.specificationVersion}${item.source ? `: ${item.source}` : ''}`.slice(
              0,
              500,
            ),
          unitPrice: item.unitPrice,
          currency: item.currency || 'RUB',
          region: '',
          terms: item.term.slice(0, 1000),
          priceDate: null,
          validUntil: null,
          taxRate: null,
          taxExempt: false,
          discountCategory: '',
        };
  return { product, offer, configuration: item.configuration };
}
