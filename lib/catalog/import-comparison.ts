import { SpecificationError } from '../specification/validation';
import { offerInput, productInput, text } from './validation';
import { loadImport } from './import-store';
import type { ImportDraft, ImportRow } from './import-types';
import type {
  ComparisonField,
  ComparisonRow,
  ComparisonSource,
  ImportComparison,
} from './comparison-types';

const FIELDS: ComparisonField[] = [
  'name',
  'kind',
  'unit',
  'licensing',
  'attributes',
  'unitPrice',
  'currency',
  'region',
  'terms',
  'priceDate',
  'validUntil',
];
const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
// Decimal identity is lexical after removing insignificant trailing zeroes;
// no floating conversion can collapse adjacent maximum-precision prices.
function decimalIdentity(price: string | null): string | null {
  if (price === null) return null;
  return price.includes('.') ? price.replace(/0+$/, '').replace(/\.$/, '') : price;
}
function comparable(row: ImportRow): Record<ComparisonField, string | null> {
  const product = productInput(row.normalized!.product),
    offer = offerInput(row.normalized!.offer);
  return {
    name: product.name,
    kind: product.kind,
    unit: product.unit,
    licensing: product.licensing,
    attributes: JSON.stringify(
      product.attributes
        .map((a) => ({ ...a }))
        .sort((a, b) => order(a.name, b.name) || order(a.value, b.value) || order(a.unit, b.unit)),
    ),
    unitPrice: decimalIdentity(offer.unitPrice),
    currency: offer.currency,
    region: offer.region,
    terms: offer.terms,
    priceDate: offer.priceDate,
    validUntil: offer.validUntil,
  };
}
function source(batch: ImportDraft): ComparisonSource {
  return {
    id: batch.id,
    filename: batch.filename,
    checksum: batch.checksum,
    revision: batch.revision,
    vendorId: batch.profile.vendorId,
    createdAt: batch.createdAt,
    confirmedAt: batch.confirmedAt,
    sheet: batch.profile.sheet,
    headerRow: batch.profile.headerRow,
    startRow: batch.profile.startRow,
    endRow: batch.profile.endRow,
    acceptedCount: batch.rows.filter((r) => r.status === 'accepted').length,
    excludedCount: batch.rows.filter((r) => r.status === 'excluded').length,
    errorCount: batch.rows.filter((r) => r.status === 'error').length,
  };
}
export function compareImportSnapshots(before: ImportDraft, after: ImportDraft): ImportComparison {
  if (before.id === after.id) throw new SpecificationError('Выберите два разных GPL');
  if (before.status !== 'confirmed' || after.status !== 'confirmed')
    throw new SpecificationError('Сравнение доступно только для подтвержденных GPL', 409);
  if (!before.profile.vendorId || before.profile.vendorId !== after.profile.vendorId)
    throw new SpecificationError('GPL должны относиться к одному вендору');
  const groups = new Map<
    string,
    { sku: string; edition: string; before: ImportRow[]; after: ImportRow[]; invalid: boolean }
  >();
  for (const [side, batch] of [
    ['before', before],
    ['after', after],
  ] as const) {
    batch.rows.forEach((row, index) => {
      if (row.status !== 'accepted') return;
      const sku =
        typeof row.normalized?.product?.sku === 'string' ? row.normalized.product.sku : '';
      const edition =
        typeof row.normalized?.product?.edition === 'string' ? row.normalized.product.edition : '';
      const key = sku
        ? JSON.stringify([batch.profile.vendorId, sku, edition])
        : JSON.stringify(['malformed', side, index, row.id]);
      let invalid = false;
      try {
        const product = productInput(row.normalized?.product);
        offerInput(row.normalized?.offer);
        if (
          !product.sku ||
          product.vendorId !== batch.profile.vendorId ||
          row.errors.length ||
          product.sku !== sku ||
          product.edition !== edition
        )
          invalid = true;
      } catch {
        invalid = true;
      }
      const group = groups.get(key) ?? { sku, edition, before: [], after: [], invalid: false };
      group[side].push(row);
      group.invalid ||= invalid;
      groups.set(key, group);
    });
  }
  const rows: ComparisonRow[] = [];
  const counts: ImportComparison['counts'] = {
    added: 0,
    missing: 0,
    changed: 0,
    unchanged: 0,
    ambiguous: 0,
  };
  for (const [key, group] of [...groups.entries()].sort(
    (a, b) => order(a[1].sku, b[1].sku) || order(a[1].edition, b[1].edition) || order(a[0], b[0]),
  )) {
    let status: ComparisonRow['status'];
    const changes: ComparisonRow['changes'] = [];
    if (group.invalid || group.before.length > 1 || group.after.length > 1) status = 'ambiguous';
    else if (!group.before.length) status = 'added';
    else if (!group.after.length) status = 'missing';
    else {
      const b = comparable(group.before[0]),
        a = comparable(group.after[0]);
      for (const field of FIELDS)
        if (b[field] !== a[field]) changes.push({ field, before: b[field], after: a[field] });
      status = changes.length ? 'changed' : 'unchanged';
    }
    counts[status]++;
    rows.push({
      key,
      sku: group.sku,
      edition: group.edition,
      status,
      before: group.before,
      after: group.after,
      changes,
    });
  }
  const beforeSource = source(before),
    afterSource = source(after);
  const warnings = [
    'Сравниваются только подтвержденные выбранные строки. Отсутствие позиции в новом наборе не доказывает снятие с продажи или исключение из полного прайса.',
  ];
  for (const [label, batch, coverage] of [
    ['Первый GPL', before, beforeSource],
    ['Второй GPL', after, afterSource],
  ] as const) {
    if (
      coverage.excludedCount ||
      coverage.errorCount ||
      batch.rows.some((r) => r.status === 'ready')
    )
      warnings.push(
        `${label}: часть строк не подтверждена (исключено ${coverage.excludedCount}, ошибок ${coverage.errorCount}).`,
      );
    if (batch.profile.startRow !== batch.profile.headerRow + 1 || batch.profile.endRow !== null)
      warnings.push(`${label}: анализ ограничен выбранным диапазоном строк.`);
    if (batch.sheets.length > 1)
      warnings.push(
        `${label}: выбран только лист «${batch.profile.sheet}» из ${batch.sheets.length}.`,
      );
  }
  if (counts.ambiguous)
    warnings.push(
      `Неоднозначные или некорректные подтвержденные позиции: ${counts.ambiguous}. Автоматическое сопоставление не выполнено.`,
    );
  return { before: beforeSource, after: afterSource, rows, counts, warnings };
}
export async function compareImports(beforeId: string, afterId: string): Promise<ImportComparison> {
  beforeId = text(beforeId, 'Первый GPL', 100, true);
  afterId = text(afterId, 'Второй GPL', 100, true);
  if (beforeId === afterId) throw new SpecificationError('Выберите два разных GPL');
  const [before, after] = await Promise.all([loadImport(beforeId), loadImport(afterId)]);
  return compareImportSnapshots(before, after);
}
