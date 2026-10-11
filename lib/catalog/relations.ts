// Client-safe rules for catalog product relations (replacements, alternatives,
// bundle composition). The store applies them under an advisory lock.
import { SpecificationError, isDecimal } from '../specification/validation';
import { lineAmount } from '../specification/totals';
import type { SpecificationItem } from '../specification/types';
import { object, text } from './validation';

export const RELATION_TYPES = ['replaces', 'alternative', 'bundleComponent'] as const;
export type RelationType = (typeof RELATION_TYPES)[number];
export const RELATION_LABELS: Record<RelationType, string> = {
  replaces: 'заменяет',
  alternative: 'альтернатива',
  bundleComponent: 'компонент комплекта',
};

export interface RelationInput {
  fromProductId: string;
  toProductId: string;
  type: RelationType;
  /** Component quantity per one bundle (bundleComponent only), exact decimal. */
  quantity: string | null;
  note: string;
}
export interface ProductRelation extends RelationInput {
  id: string;
  createdBy: string;
  createdAt: string;
  archivedAt: string | null;
  archivedBy: string | null;
}
type Edge = Pick<RelationInput, 'fromProductId' | 'toProductId' | 'type'>;

/**
 * Semantics (direction matters):
 * - replaces: `from` replaces `to` — «to заменено на from»;
 * - alternative: `from` and `to` are interchangeable (shown on both sides);
 * - bundleComponent: `to` is a component of bundle `from`, `quantity` per one bundle.
 */
export function relationInput(input: unknown): RelationInput {
  const d = object(input);
  if (!(RELATION_TYPES as readonly unknown[]).includes(d.type))
    throw new SpecificationError('Некорректный тип связи');
  const type = d.type as RelationType;
  const fromProductId = text(d.fromProductId, 'Исходная позиция', 100, true);
  const toProductId = text(d.toProductId, 'Связанная позиция', 100, true);
  if (fromProductId === toProductId)
    throw new SpecificationError('Позиция не может ссылаться на саму себя');
  let quantity: string | null = null;
  if (type === 'bundleComponent') {
    if (!isDecimal(d.quantity) || !/[1-9]/.test(String(d.quantity)))
      throw new SpecificationError('Количество компонента в комплекте: положительное число');
    quantity = d.quantity as string;
  } else if (d.quantity !== undefined && d.quantity !== null && d.quantity !== '')
    throw new SpecificationError('Количество задается только для компонента комплекта');
  return {
    fromProductId,
    toProductId,
    type,
    quantity,
    note: d.note === undefined ? '' : text(d.note, 'Комментарий', 1000),
  };
}

/**
 * True when adding `edge` closes a directed cycle among active edges of the same
 * type. Only replacement chains and bundle composition are acyclic; alternatives
 * are symmetric and only reject duplicates (both directions).
 */
export function createsCycle(edges: Edge[], edge: Edge): boolean {
  if (edge.fromProductId === edge.toProductId) return true;
  if (edge.type === 'alternative') return false;
  const next = new Map<string, string[]>();
  for (const e of edges) {
    if (e.type !== edge.type) continue;
    next.set(e.fromProductId, [...(next.get(e.fromProductId) ?? []), e.toProductId]);
  }
  // A cycle appears iff `from` is reachable from `to`.
  const seen = new Set<string>();
  const stack = [edge.toProductId];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === edge.fromProductId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(next.get(id) ?? []));
  }
  return false;
}

/** Validates a new relation against the active ones: duplicates, mirrored alternatives, cycles. */
export function checkRelation(active: Edge[], edge: Edge) {
  const same = (a: Edge, from: string, to: string) =>
    a.type === edge.type && a.fromProductId === from && a.toProductId === to;
  if (active.some((a) => same(a, edge.fromProductId, edge.toProductId)))
    throw new SpecificationError('Такая связь уже существует', 409);
  if (
    edge.type === 'alternative' &&
    active.some((a) => same(a, edge.toProductId, edge.fromProductId))
  )
    throw new SpecificationError('Альтернатива уже задана в обратном направлении', 409);
  if (createsCycle(active, edge))
    throw new SpecificationError(
      edge.type === 'replaces'
        ? 'Цикл замен: позиция не может заменять свою замену'
        : 'Цикл состава: комплект не может входить в собственный компонент',
      409,
    );
}

/** Active replacements of a product («заменено на …»), newest relation first. */
export function replacementsOf(relations: ProductRelation[], productId: string) {
  return relations.filter(
    (r) => r.type === 'replaces' && r.toProductId === productId && !r.archivedAt,
  );
}
/** IDs of active alternatives of a product, in both directions. */
export function alternativesOf(relations: ProductRelation[], productId: string) {
  return relations
    .filter((r) => r.type === 'alternative' && !r.archivedAt)
    .flatMap((r) =>
      r.fromProductId === productId
        ? [{ relation: r, productId: r.toProductId }]
        : r.toProductId === productId
          ? [{ relation: r, productId: r.fromProductId }]
          : [],
    );
}
export function componentsOf(relations: ProductRelation[], bundleId: string) {
  return relations.filter(
    (r) => r.type === 'bundleComponent' && r.fromProductId === bundleId && !r.archivedAt,
  );
}

/**
 * Component quantity for `bundles` bundles: exact bundles × per-bundle quantity.
 * Unknown bundle quantity keeps the component quantity unknown (never 1 or 0).
 */
export function componentQuantity(bundles: string | null, perBundle: string): string | null {
  if (bundles === null) return null;
  if (!isDecimal(bundles) || !isDecimal(perBundle))
    throw new SpecificationError('Количество комплекта: неотрицательное десятичное число');
  const amount = lineAmount({ quantity: bundles, unitPrice: perBundle })!;
  if (!isDecimal(amount))
    throw new SpecificationError('Количество компонента превышает точность спецификации');
  return amount;
}

/**
 * After a bundle quantity edit: components with a recorded per-bundle quantity get
 * bundles × per bundle (unknown when the bundle quantity is unknown or invalid);
 * a changed component loses its confirmation.
 */
export function syncBundleComponents(items: SpecificationItem[], bundleId: string) {
  const bundle = items.find((i) => i.id === bundleId);
  if (!bundle || bundle.kind !== 'bundle') return items;
  return items.map((item) => {
    if (item.includedIn !== bundleId || !item.perBundle) return item;
    let quantity: string | null = null;
    try {
      quantity =
        bundle.quantity !== null && isDecimal(bundle.quantity)
          ? componentQuantity(bundle.quantity, item.perBundle)
          : null;
    } catch {
      quantity = null;
    }
    return quantity === item.quantity ? item : { ...item, quantity, confirmed: false };
  });
}

/**
 * Expands a copied bundle row with copies of its components. Components reference the
 * bundle via `includedIn`, so totals count only the bundle row (no double counting).
 */
export function expandBundle(
  bundle: SpecificationItem,
  components: Array<{ item: SpecificationItem; perBundle: string }>,
): SpecificationItem[] {
  if (bundle.kind !== 'bundle')
    throw new SpecificationError('Состав раскрывается только для позиции-комплекта');
  return [
    bundle,
    ...components.map(({ item, perBundle }) => ({
      ...item,
      quantity: componentQuantity(bundle.quantity, perBundle),
      rationale: `Состав комплекта «${bundle.name}»: ${perBundle} ${item.unit} на 1 комплект`,
      includedIn: bundle.id,
      perBundle,
    })),
  ];
}
