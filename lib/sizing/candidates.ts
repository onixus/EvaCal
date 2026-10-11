/**
 * #101 §5: подбор каталожных позиций по метрике сайзинга.
 *
 * Результат — только кандидаты: несколько альтернатив с расчетным количеством и
 * стоимостью. Ничего не добавляется в спецификацию автоматически: пользователь
 * явно выбирает кандидата, и строка сохраняется обычным путем как новая черновая
 * редакция (со связью sizingRef).
 *
 * Позиция — кандидат, если ее характеристика задает ёмкость единицы по метрике:
 * название характеристики (или ключ ее определения в справочнике) совпадает с
 * ключом или названием метрики, значение — положительное число, а единица
 * совместима с единицей метрики. Цена берется только из подтвержденных
 * действующих предложений текущей редакции позиции; без них цена неизвестна
 * (не ноль).
 */
import type { Attribute, Offer, Product } from '../catalog/types';
import { findDefinition, type AttributeDefinition } from '../catalog/attributes';
import { catalogItem } from '../catalog/snapshot';
import type { SpecificationItem } from '../specification/types';
import { isDecimal } from '../specification/validation';
import { lineAmount, subtractDecimal, toScaled } from '../specification/totals';
import { ceilQuantity } from './impact';

export interface CandidateMetric {
  key: string;
  label: string;
  unit: string;
  /** Потребность (десятичная строка) в прогоне. */
  required: string;
  scenario: string;
}

export interface CatalogCandidate {
  productId: string;
  offerId: string | null;
  name: string;
  vendor: string;
  sku: string;
  edition: string;
  unit: string;
  /** Характеристика, задающая ёмкость единицы. */
  attribute: string;
  unitCapacity: string;
  quantity: string;
  /** quantity × unitCapacity. */
  coverage: string;
  /** coverage − required (≥ 0). */
  surplus: string;
  /** null — подтвержденной действующей цены нет: стоимость неизвестна. */
  unitPrice: string | null;
  currency: string;
  amount: string | null;
  offer: { source: string; priceDate: string | null; validUntil: string | null } | null;
  /** Готовая строка спецификации (каталожное происхождение, sizingRef); не подтверждена. */
  item: SpecificationItem;
}

export interface CandidateProposal {
  metric: CandidateMetric;
  candidates: CatalogCandidate[];
  /** Позиции с подходящей характеристикой, отклоненные с причиной (единица, значение). */
  skipped: string[];
}

export const MAX_CANDIDATES = 20;

const normalizeName = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
const normalizeUnit = (value: string) =>
  value.trim().toLowerCase().replace(/\.$/, '').replace(/\s+/g, '');

/** Положительное число характеристики («5 000», «2,5») → десятичная строка; иначе null. */
export function capacityValue(raw: string): string | null {
  const text = raw.replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const trimmed = text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
  const normalized = trimmed.replace(/^0+(?=\d)/, '');
  if (!isDecimal(normalized) || toScaled(normalized) <= BigInt(0)) return null;
  return normalized;
}

function matchesMetric(
  attribute: Attribute,
  metric: Pick<CandidateMetric, 'key' | 'label'>,
  definitions: AttributeDefinition[],
) {
  const name = normalizeName(attribute.name);
  if (name === normalizeName(metric.key) || (metric.label && name === normalizeName(metric.label)))
    return true;
  const definition = findDefinition(definitions, attribute.name);
  return Boolean(definition && normalizeName(definition.key) === normalizeName(metric.key));
}

function usableOffers(product: Product, today: string): Offer[] {
  return product.offers.filter(
    (offer) =>
      offer.confirmationStatus === 'confirmed' &&
      offer.productRevision === product.revision &&
      offer.productSnapshot !== null &&
      offer.unitPrice !== null &&
      (!offer.validUntil || offer.validUntil >= today),
  );
}

/** Ранжирование: известная цена раньше неизвестной; внутри валюты — дешевле, затем меньший избыток. */
export function compareCandidates(a: CatalogCandidate, b: CatalogCandidate): number {
  if ((a.amount === null) !== (b.amount === null)) return a.amount === null ? 1 : -1;
  if (a.amount !== null && b.amount !== null) {
    if (a.currency !== b.currency) return a.currency < b.currency ? -1 : 1;
    const delta = toScaled(a.amount) - toScaled(b.amount);
    if (delta !== BigInt(0)) return delta < BigInt(0) ? -1 : 1;
  }
  const surplus = toScaled(a.surplus) - toScaled(b.surplus);
  if (surplus !== BigInt(0)) return surplus < BigInt(0) ? -1 : 1;
  return a.name.localeCompare(b.name, 'ru') || a.productId.localeCompare(b.productId);
}

export function proposeCatalogCandidates(input: {
  products: Product[];
  definitions: AttributeDefinition[];
  metric: CandidateMetric;
  run: { id: string; label: string };
  /** YYYY-MM-DD: предложения с истекшим сроком действия цены не используются. */
  today: string;
  limit?: number;
}): CandidateProposal {
  const { metric, run } = input;
  const candidates: CatalogCandidate[] = [];
  const skipped: string[] = [];
  for (const product of input.products) {
    if (product.archived || product.vendor.archived) continue;
    const attribute = product.attributes.find((a) => matchesMetric(a, metric, input.definitions));
    if (!attribute) continue;
    const label = `${product.vendor.name} ${product.name}${product.sku ? ` (${product.sku})` : ''}`;
    const capacity = capacityValue(attribute.value);
    if (!capacity) {
      skipped.push(`${label}: «${attribute.name}» = «${attribute.value}» — не положительное число`);
      continue;
    }
    const unit = attribute.unit || findDefinition(input.definitions, attribute.name)?.unit || '';
    if (unit && metric.unit && normalizeUnit(unit) !== normalizeUnit(metric.unit)) {
      skipped.push(
        `${label}: единица «${unit}» не совпадает с единицей метрики «${metric.unit}» — соответствие проверить невозможно`,
      );
      continue;
    }
    const quantity = ceilQuantity(metric.required, capacity);
    const coverage = lineAmount({ quantity, unitPrice: capacity })!;
    const surplus = subtractDecimal(coverage, metric.required);
    const offers = usableOffers(product, input.today);
    for (const offer of offers.length ? offers : [undefined]) {
      const item = catalogItem(product, offer);
      item.quantity = quantity;
      item.sizingRef = {
        runId: run.id,
        metric: metric.key,
        ...(metric.scenario === 'base' ? {} : { scenario: metric.scenario }),
        requiredQuantity: metric.required,
        ...(capacity === '1' ? {} : { unitCapacity: capacity }),
      };
      item.rationale = `Подбор по сайзингу: ${metric.label || metric.key} = ${metric.required}${metric.unit ? ` ${metric.unit}` : ''} (${run.label}); ${attribute.name} = ${capacity}${unit ? ` ${unit}` : ''} на единицу → ${quantity} ${product.unit || 'ед.'}`;
      item.changeReason = 'Добавлено из кандидатов каталога по сайзингу (выбор пользователя).';
      candidates.push({
        productId: product.id,
        offerId: offer?.id ?? null,
        name: product.name,
        vendor: product.vendor.name,
        sku: product.sku,
        edition: product.edition,
        unit: product.unit,
        attribute: attribute.name,
        unitCapacity: capacity,
        quantity,
        coverage,
        surplus,
        unitPrice: offer?.unitPrice ?? null,
        currency: offer?.currency || '',
        amount: offer ? lineAmount({ quantity, unitPrice: offer.unitPrice }) : null,
        offer: offer
          ? { source: offer.source, priceDate: offer.priceDate, validUntil: offer.validUntil }
          : null,
        item,
      });
    }
  }
  candidates.sort(compareCandidates);
  return { metric, candidates: candidates.slice(0, input.limit ?? MAX_CANDIDATES), skipped };
}
