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
  if (offer && !offer.productSnapshot)
    throw new SpecificationError(
      'Для этого предложения не сохранены исторические характеристики. Создайте новое предложение.',
    );
  const technical = offer?.productSnapshot || product;
  const copied: SpecificationItem = {
    id,
    kind: technical.kind,
    disposition: 'supply',
    name: technical.name,
    vendor: technical.vendor.name,
    sku: technical.sku,
    quantity: null,
    unit: technical.unit,
    configuration: [
      technical.edition && `Редакция: ${technical.edition}`,
      ...technical.attributes.map((a) => `${a.name}: ${a.value}${a.unit ? ` ${a.unit}` : ''}`),
    ]
      .filter(Boolean)
      .join('; '),
    licensing: technical.licensing,
    term: offer?.terms || '',
    source: `Каталог ${product.id}, ред. ${product.revision}; вендор ред. ${technical.vendor.revision}${offer ? `; предложение ${offer.id}: ${offer.source}; дата цены ${offer.priceDate || 'неизвестна'}; действует до ${offer.validUntil || 'неизвестно'}; регион ${offer.region || 'не задан'}` : '; цена не выбрана'}${offer?.importProvenance ? `; GPL ${offer.importProvenance.importId}, ред. ${offer.importProvenance.importRevision}; SHA-256 ${offer.importProvenance.checksum}; лист ${offer.importProvenance.sheet}, строка ${offer.importProvenance.rowNumber}` : ''}`,
    rationale: '',
    confirmed: false,
    unitPrice: offer?.unitPrice ?? null,
    currency: offer?.currency || 'RUB',
  };
  copied.origin = {
    vendorId: technical.vendorId,
    vendorName: technical.vendor.name,
    productId: product.id,
    productRevision: technical.revision,
    offerId: offer?.id ?? null,
    sku: technical.sku,
    edition: technical.edition,
    import: offer?.importProvenance
      ? {
          importId: offer.importProvenance.importId,
          revision: offer.importProvenance.importRevision + 1,
          checksum: offer.importProvenance.checksum,
          sheet: offer.importProvenance.sheet,
          rowNumber: offer.importProvenance.rowNumber,
        }
      : null,
    baseline: {
      name: copied.name,
      kind: copied.kind,
      unit: copied.unit,
      configuration: copied.configuration,
      licensing: copied.licensing,
      term: copied.term,
      source: copied.source,
      unitPrice: copied.unitPrice,
      currency: copied.currency,
    },
  };
  return copied;
}
