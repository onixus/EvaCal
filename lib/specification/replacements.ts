// Explicit replacement of a catalog row whose product was replaced in the catalog.
// Never automatic: preview lists candidates; apply creates a new draft revision through
// the verified server save path (the released/confirmed revision stays unchanged).
import { loadCatalog } from '../catalog/store';
import { catalogItem } from '../catalog/snapshot';
import {
  componentsOf,
  expandBundle,
  replacementsOf,
  type ProductRelation,
} from '../catalog/relations';
import { object, revision, text } from '../catalog/validation';
import type { Product } from '../catalog/types';
import { loadSpecification, saveSpecification } from './store';
import { parseSpecification, SpecificationError } from './validation';
import type { SpecificationItem, SpecificationSnapshot } from './types';
import { newRowId } from '../rowId';

export interface ReplacementOption {
  relationId: string;
  note: string;
  productId: string;
  label: string;
  archived: boolean;
  offers: Array<{ id: string; label: string }>;
  /** The replacement is a bundle: its catalog composition replaces the row's components. */
  isBundle: boolean;
  componentCount: number;
  /** Why this replacement cannot be applied to the row (null when allowed). */
  blocked: string | null;
  /** Replacing a bundle by a non-bundle removes its components: explicit consent needed. */
  dropsComponents: boolean;
}
export interface ReplacementCandidate {
  itemId: string;
  itemName: string;
  productId: string;
  productLabel: string;
  productArchived: boolean;
  /** Component rows of this (bundle) row in the specification. */
  componentCount: number;
  isComponent: boolean;
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

/** Up-front structural check of replacing `item` by `product`. */
function structure(item: SpecificationItem, componentCount: number, product: Product) {
  if (item.includedIn && product.kind === 'bundle')
    return {
      blocked:
        'Компонент комплекта нельзя заменить комплектом: вложенные комплекты не поддерживаются.',
      dropsComponents: false,
    };
  return { blocked: null, dropsComponents: componentCount > 0 && product.kind !== 'bundle' };
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
    const componentCount = snapshot.items.filter((i) => i.includedIn === item.id).length;
    result.push({
      itemId: item.id,
      itemName: item.name,
      productId,
      productLabel: old ? label(old) : productId,
      productArchived: Boolean(old?.archived),
      componentCount,
      isComponent: Boolean(item.includedIn),
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
            isBundle: next.kind === 'bundle',
            componentCount: componentsOf(relations, next.id).length,
            ...structure(item, componentCount, next),
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
    ...(item.includedIn && item.perBundle ? { perBundle: item.perBundle } : {}),
    // The quantity is kept, so the sizing link stays with the row.
    ...(item.sizingRef ? { sizingRef: item.sizingRef } : {}),
  };
}

/**
 * Pure: replaces one row in the item list with the bundle rules applied up front:
 * - a component cannot become a bundle (no nesting) → 409;
 * - a bundle with components replaced by a non-bundle drops its components only with
 *   explicit consent (`dropComponents`) → 409 otherwise;
 * - a replacement bundle rebuilds the composition from its catalog components
 *   (old component rows are removed, new ones follow the bundle row).
 */
export function replaceInItems(
  items: SpecificationItem[],
  itemId: string,
  product: Product,
  offer: Product['offers'][number] | undefined,
  relation: ProductRelation,
  catalog: { products: Product[]; relations: ProductRelation[] },
  options: { dropComponents?: boolean; newId?: () => string } = {},
): SpecificationItem[] {
  const item = items.find((row) => row.id === itemId);
  if (!item) throw new SpecificationError('Строка не найдена', 404);
  const components = items.filter((row) => row.includedIn === itemId);
  const check = structure(item, components.length, product);
  if (check.blocked) throw new SpecificationError(check.blocked, 409);
  if (check.dropsComponents && !options.dropComponents)
    throw new SpecificationError(
      `Строка — комплект с составом (${components.length} поз.), замена не является комплектом: подтвердите удаление состава.`,
      409,
    );
  const replaced = replaceItem(item, product, offer, relation);
  let rows = [replaced];
  if (product.kind === 'bundle') {
    const byId = new Map(catalog.products.map((p) => [p.id, p]));
    const newId = options.newId ?? (() => newRowId());
    rows = expandBundle(
      replaced,
      componentsOf(catalog.relations, product.id).map((r) => {
        const component = byId.get(r.toProductId);
        if (!component)
          throw new SpecificationError('Компонент комплекта замены не найден в каталоге', 409);
        return { item: catalogItem(component, undefined, newId()), perBundle: r.quantity! };
      }),
    );
    if (components.length)
      rows[0] = {
        ...rows[0],
        changeReason:
          `${rows[0].changeReason}; состав пересобран по каталогу (${rows.length - 1} поз. вместо ${components.length})`.slice(
            0,
            1000,
          ),
      };
  }
  return items.flatMap((row) =>
    row.id === itemId ? rows : row.includedIn === itemId ? [] : [row],
  );
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
  if (d.dropComponents !== undefined && typeof d.dropComponents !== 'boolean')
    throw new SpecificationError('Удаление состава: требуется логическое значение');
  const saved = await loadSpecification(calculationId);
  if (!saved || saved.snapshot.version !== version)
    throw new SpecificationError('Спецификация изменена. Обновите данные.', 409);
  const item = saved.snapshot.items.find((row) => row.id === itemId);
  if (!item?.origin) throw new SpecificationError('Строка не связана с каталогом', 409);
  const catalog = await loadCatalog();
  const relation = catalog.relations.find((r) => r.id === relationId);
  if (
    !relation ||
    relation.archivedAt ||
    relation.type !== 'replaces' ||
    relation.toProductId !== item.origin.productId
  )
    throw new SpecificationError('Связь замены не найдена или не относится к строке', 409);
  const products = catalog.products as unknown as Product[];
  const product = products.find((p) => p.id === relation.fromProductId);
  if (!product) throw new SpecificationError('Позиция замены не найдена', 404);
  const offer = offerId ? usableOffers(product).find((o) => o.id === offerId) : undefined;
  if (offerId && !offer)
    throw new SpecificationError('Предложение не относится к текущей редакции замены', 409);
  const next = parseSpecification({
    ...saved.snapshot,
    status: 'draft',
    items: replaceInItems(
      saved.snapshot.items,
      itemId,
      product,
      offer,
      relation,
      { products, relations: catalog.relations },
      { dropComponents: d.dropComponents === true },
    ),
  });
  // Built server-side from the stored catalog: same trust model as the GPL apply path.
  // The relation and the replacement revision are re-checked inside the write transaction.
  return saveSpecification(calculationId, next, actorId, {
    allowOriginUpdates: true,
    beforeWrite: async (tx) => {
      const current = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT r.id FROM "CatalogProductRelation" r
        JOIN "CatalogProduct" p ON p.id = r."fromProductId"
        WHERE r.id = ${relationId} AND r."archivedAt" IS NULL AND r.type = 'replaces'
          AND r."toProductId" = ${item.origin!.productId}
          AND p.archived = false AND p.revision = ${product.revision}
        FOR SHARE OF r
      `;
      if (!current.length)
        throw new SpecificationError(
          'Связь замены или позиция замены изменены во время сохранения. Обновите данные.',
          409,
        );
    },
  });
}
