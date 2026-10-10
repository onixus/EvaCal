// Explicit replacement of a catalog row whose product was replaced in the catalog.
// Never automatic: preview lists candidates; apply creates a new draft revision through
// the verified server save path (the released/confirmed revision stays unchanged).
import { prisma } from '../prisma';
import { loadCatalog } from '../catalog/store';
import { catalogItem } from '../catalog/snapshot';
import { replacementsOf, type ProductRelation } from '../catalog/relations';
import { object, revision, text } from '../catalog/validation';
import type { Product } from '../catalog/types';
import { loadSpecification, saveSpecification } from './store';
import { parseSpecification, SpecificationError } from './validation';
import type { SpecificationItem, SpecificationSnapshot } from './types';

export interface ReplacementOption {
  relationId: string;
  note: string;
  productId: string;
  label: string;
  archived: boolean;
  offers: Array<{ id: string; label: string }>;
}
export interface ReplacementCandidate {
  itemId: string;
  itemName: string;
  productId: string;
  productLabel: string;
  productArchived: boolean;
  options: ReplacementOption[];
}

const label = (p: Pick<Product, 'name' | 'sku' | 'edition'> & { vendor: { name: string } }) =>
  [p.vendor.name, p.name, p.sku, p.edition].filter(Boolean).join(' · ');

/** Usable offers of the current product revision (with an immutable technical snapshot). */
export function usableOffers(product: Product) {
  return product.offers.filter(
    (o) => o.productRevision === product.revision && o.productSnapshot !== null,
  );
}

/** Pure: rows referencing a product that has an active replacement. */
export function replacementCandidates(
  snapshot: Pick<SpecificationSnapshot, 'items'>,
  products: Product[],
  relations: ProductRelation[],
): ReplacementCandidate[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  const result: ReplacementCandidate[] = [];
  for (const item of snapshot.items) {
    const productId = item.origin?.productId;
    if (!productId) continue;
    const replacements = replacementsOf(relations, productId);
    if (!replacements.length) continue;
    const old = byId.get(productId);
    result.push({
      itemId: item.id,
      itemName: item.name,
      productId,
      productLabel: old ? label(old) : productId,
      productArchived: Boolean(old?.archived),
      options: replacements.flatMap((r) => {
        const next = byId.get(r.fromProductId);
        if (!next) return [];
        return [
          {
            relationId: r.id,
            note: r.note,
            productId: next.id,
            label: label(next),
            archived: next.archived || next.vendor.archived,
            offers: usableOffers(next).map((o) => ({
              id: o.id,
              label: `${o.confirmationStatus === 'confirmed' ? 'Цена подтверждена' : 'Цена не подтверждена'} · ${o.unitPrice ?? 'неизвестно'} ${o.currency} · ${o.source}`,
            })),
          },
        ];
      }),
    });
  }
  return result;
}

/**
 * Pure: the replaced row keeps its ID, quantity, disposition, rationale, bundle and sizing links;
 * technical data, price and origin come from the replacement product. Confirmation is
 * reset and the change reason documents the replacement.
 */
export function replaceItem(
  item: SpecificationItem,
  product: Product,
  offer: Product['offers'][number] | undefined,
  relation: ProductRelation,
): SpecificationItem {
  const copy = catalogItem(product, offer, item.id);
  return {
    ...copy,
    disposition: item.disposition,
    quantity: item.quantity,
    rationale: item.rationale,
    confirmed: false,
    changeReason:
      `Замена по каталогу: ${item.vendor} ${item.sku || item.name} → ${copy.vendor} ${copy.sku || copy.name}${relation.note ? ` (${relation.note})` : ''}`.slice(
        0,
        1000,
      ),
    ...(item.includedIn ? { includedIn: item.includedIn } : {}),
    // The quantity is kept, so the sizing link stays with the row.
    ...(item.sizingRef ? { sizingRef: item.sizingRef } : {}),
  };
}

export async function previewReplacements(calculationId: string) {
  const saved = await loadSpecification(calculationId);
  if (!saved) return { version: 0, candidates: [] as ReplacementCandidate[] };
  const catalog = await loadCatalog();
  return {
    version: saved.snapshot.version,
    candidates: replacementCandidates(
      saved.snapshot,
      catalog.products as unknown as Product[],
      catalog.relations,
    ),
  };
}

export async function applyReplacement(calculationId: string, input: unknown, actorId: string) {
  const d = object(input);
  const version = revision(d.version);
  const itemId = text(d.itemId, 'Строка', 100, true);
  const relationId = text(d.relationId, 'Связь', 100, true);
  const offerId =
    d.offerId === null || d.offerId === undefined || d.offerId === ''
      ? null
      : text(d.offerId, 'Предложение', 100, true);
  const saved = await loadSpecification(calculationId);
  if (!saved || saved.snapshot.version !== version)
    throw new SpecificationError('Спецификация изменена. Обновите данные.', 409);
  const item = saved.snapshot.items.find((row) => row.id === itemId);
  if (!item?.origin) throw new SpecificationError('Строка не связана с каталогом', 409);
  const relation = await prisma.catalogProductRelation.findUnique({ where: { id: relationId } });
  if (
    !relation ||
    relation.archivedAt ||
    relation.type !== 'replaces' ||
    relation.toProductId !== item.origin.productId
  )
    throw new SpecificationError('Связь замены не найдена или не относится к строке', 409);
  const catalog = await loadCatalog();
  const product = (catalog.products as unknown as Product[]).find(
    (p) => p.id === relation.fromProductId,
  );
  if (!product) throw new SpecificationError('Позиция замены не найдена', 404);
  const offer = offerId ? usableOffers(product).find((o) => o.id === offerId) : undefined;
  if (offerId && !offer)
    throw new SpecificationError('Предложение не относится к текущей редакции замены', 409);
  const next = parseSpecification({
    ...saved.snapshot,
    status: 'draft',
    items: saved.snapshot.items.map((row) =>
      row.id === itemId
        ? replaceItem(
            row,
            product,
            offer,
            catalog.relations.find((r) => r.id === relationId)!,
          )
        : row,
    ),
  });
  // Built server-side from the stored catalog: same trust model as the GPL apply path.
  return saveSpecification(calculationId, next, actorId, { allowOriginUpdates: true });
}
