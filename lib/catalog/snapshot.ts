import type { Product, Offer } from './types';
import type { SpecificationItem } from '../specification/types';
import { SpecificationError } from '../specification/validation';
/** Explicit copy: subsequent edits/archive/price offers cannot mutate this row. */
export function catalogItem(
  product: Product,
  offer?: Offer,
  id = crypto.randomUUID(),
): SpecificationItem {
  if (product.archived || product.vendor.archived)
    throw new SpecificationError('Позиция или вендор архивированы');
  if (offer && offer.productRevision !== product.revision)
    throw new SpecificationError('Предложение относится к предыдущей редакции позиции');
  if (offer && !product.offers.some((o) => o.id === offer.id))
    throw new SpecificationError('Предложение относится к другой позиции');
  return {
    id,
    kind: product.kind,
    disposition: 'supply',
    name: product.name,
    vendor: product.vendor.name,
    sku: product.sku,
    quantity: null,
    unit: product.unit,
    configuration: [
      product.edition && `Редакция: ${product.edition}`,
      ...product.attributes.map((a) => `${a.name}: ${a.value}${a.unit ? ` ${a.unit}` : ''}`),
    ]
      .filter(Boolean)
      .join('; '),
    licensing: product.licensing,
    term: offer?.terms || '',
    source: `Каталог ${product.id}, ред. ${product.revision}; вендор ред. ${product.vendor.revision}${offer ? `; предложение ${offer.id}: ${offer.source}; дата цены ${offer.priceDate || 'неизвестна'}; действует до ${offer.validUntil || 'неизвестно'}; регион ${offer.region || 'не задан'}` : '; цена не выбрана'}`,
    rationale: '',
    confirmed: false,
    unitPrice: offer?.unitPrice ?? null,
    currency: offer?.currency || 'RUB',
  };
}
