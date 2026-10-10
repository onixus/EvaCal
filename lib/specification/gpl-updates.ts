import { loadImport } from '../catalog/import-store';
import { productInput, offerInput, object, text, revision } from '../catalog/validation';
import { loadSpecification, saveSpecification } from './store';
import { parseSpecification, SpecificationError } from './validation';
import {
  applyGplUpdateSelections,
  equalGplValue,
  parseGplSelections,
  summarizeSpecification,
} from './gpl-update-selection';
import {
  GPL_UPDATE_FIELDS,
  type GplCopiedFields,
  type GplUpdatePreview,
  type GplUpdateSelection,
  type SpecificationImportOrigin,
} from './gpl-update-types';
import type { ImportDraft, ImportRow } from '../catalog/import-types';
import type { SpecificationSnapshot } from './types';

function copied(row: ImportRow, batch: ImportDraft): GplCopiedFields {
  const p = productInput(row.normalized!.product),
    o = offerInput(row.normalized!.offer);
  return {
    name: p.name,
    kind: p.kind,
    unit: p.unit,
    configuration: [
      p.edition && `Редакция: ${p.edition}`,
      ...p.attributes.map((a) => `${a.name}: ${a.value}${a.unit ? ` ${a.unit}` : ''}`),
    ]
      .filter(Boolean)
      .join('; '),
    licensing: p.licensing,
    term: o.terms,
    source: `GPL ${batch.filename}, ред. ${batch.revision}; SHA-256 ${batch.checksum}; лист ${row.sheet}, строка ${row.rowNumber}`,
    unitPrice: o.unitPrice,
    currency: o.currency,
  };
}
function targetOrigin(batch: ImportDraft, row: ImportRow): SpecificationImportOrigin {
  return {
    importId: batch.id,
    revision: batch.revision,
    checksum: batch.checksum,
    sheet: row.sheet,
    rowNumber: row.rowNumber,
  };
}
function checkedRow(row: ImportRow, vendorId: string): boolean {
  try {
    const p = productInput(row.normalized!.product);
    offerInput(row.normalized!.offer);
    return (
      row.status === 'accepted' &&
      Array.isArray(row.errors) &&
      !row.errors.length &&
      p.vendorId === vendorId &&
      Boolean(p.sku)
    );
  } catch {
    return false;
  }
}
export async function buildGplUpdatePreview(
  snapshot: SpecificationSnapshot,
  target: ImportDraft,
  resolveSource: (source: SpecificationImportOrigin) => Promise<ImportDraft | null>,
  selected?: GplUpdateSelection[],
): Promise<GplUpdatePreview> {
  snapshot = parseSpecification(snapshot);
  if (target.status !== 'confirmed')
    throw new SpecificationError('Выберите подтвержденный GPL', 409);
  const rows: GplUpdatePreview['rows'] = [];
  for (const item of snapshot.items) {
    const result: GplUpdatePreview['rows'][number] = {
      itemId: item.id,
      name: item.name,
      status: 'unlinked',
      reason: 'Нет проверяемой связи с GPL. Позиция сохранена.',
      manualPrice: Boolean(item.priceOverride),
      changes: [],
      targetSource: null,
    };
    rows.push(result);
    const origin = item.origin;
    if (!origin?.import || !origin.offerId) continue;
    if (origin.vendorId !== target.profile.vendorId) {
      result.reason = 'GPL другого вендора. Позиция сохранена.';
      continue;
    }
    if (item.vendor !== origin.vendorName) {
      result.reason = 'Вендор изменен вручную. Исходная связь не используется.';
      continue;
    }
    if (item.sku !== origin.sku) {
      result.reason = 'Артикул изменен вручную. Исходная связь не используется.';
      continue;
    }
    const sources = [origin.import, ...Object.values(origin.fieldSources ?? {})];
    const baselines = new Map<string, { batch: ImportDraft; row: ImportRow }>();
    let verified = true;
    for (const source of sources) {
      const key = JSON.stringify(source);
      if (baselines.has(key)) continue;
      const batch = await resolveSource(source);
      const candidates =
        batch?.rows.filter((r) => r.sheet === source.sheet && r.rowNumber === source.rowNumber) ??
        [];
      if (
        !batch ||
        batch.status !== 'confirmed' ||
        batch.id !== source.importId ||
        batch.revision !== source.revision ||
        batch.checksum !== source.checksum ||
        batch.profile.vendorId !== origin.vendorId ||
        candidates.length !== 1 ||
        !checkedRow(candidates[0], origin.vendorId) ||
        candidates[0].normalized!.product.sku !== origin.sku ||
        candidates[0].normalized!.product.edition !== origin.edition
      ) {
        verified = false;
        break;
      }
      const identical = batch.rows.filter(
        (r) =>
          r.status === 'accepted' &&
          r.normalized?.product?.sku === origin.sku &&
          r.normalized?.product?.edition === origin.edition,
      );
      if (identical.length !== 1) {
        verified = false;
        break;
      }
      baselines.set(key, { batch, row: candidates[0] });
    }
    if (!verified) {
      result.status = 'invalid';
      result.reason = 'Исходный GPL или его происхождение не подтверждены. Позиция сохранена.';
      continue;
    }
    const matches = target.rows.filter(
      (r) =>
        r.status === 'accepted' &&
        r.normalized?.product?.sku === origin.sku &&
        r.normalized?.product?.edition === origin.edition,
    );
    if (!matches.length) {
      result.status = 'missing';
      result.reason =
        'Нет совпадения в подтвержденном наборе нового GPL. Это не доказательство снятия с продажи.';
      continue;
    }
    if (matches.length !== 1 || !checkedRow(matches[0], origin.vendorId)) {
      result.status = 'ambiguous';
      result.reason =
        'Неоднозначная или некорректная позиция нового GPL. Автоматическое обновление запрещено.';
      continue;
    }
    const after = copied(matches[0], target),
      base = {} as GplCopiedFields;
    for (const field of GPL_UPDATE_FIELDS) {
      const source = origin.fieldSources?.[field] ?? origin.import;
      const old = baselines.get(JSON.stringify(source))!;
      base[field] = copied(old.row, old.batch)[field] as never;
    }
    // The original catalog source text includes historical offer metadata; it is
    // descriptive and never used to identify/match a SKU or authorize a price.
    if (!origin.fieldSources?.source) base.source = origin.baseline.source;
    const currentSource = origin.fieldSources?.source ?? origin.import;
    const newSource = targetOrigin(target, matches[0]);
    if (JSON.stringify(currentSource) === JSON.stringify(newSource)) after.source = base.source;
    const manualPrice =
      Boolean(item.priceOverride) ||
      !equalGplValue('unitPrice', item.unitPrice, base.unitPrice) ||
      item.currency !== base.currency;
    result.status = 'matched';
    result.reason = 'Совпадение по вендору, артикулу и редакции.';
    result.manualPrice = manualPrice;
    result.targetSource = targetOrigin(target, matches[0]);
    const changedPrice =
      !equalGplValue('unitPrice', item.unitPrice, after.unitPrice) ||
      item.currency !== after.currency;
    for (const field of GPL_UPDATE_FIELDS) {
      if (
        equalGplValue(field, item[field], after[field]) &&
        !(changedPrice && (field === 'unitPrice' || field === 'currency'))
      )
        continue;
      const manuallyEdited =
        field === 'unitPrice' || field === 'currency'
          ? manualPrice
          : !equalGplValue(field, item[field], base[field]);
      result.changes.push({
        field,
        before: item[field],
        after: after[field],
        manuallyEdited,
        defaultSelected: !manuallyEdited,
      });
    }
  }
  const defaults = rows
    .filter((r) => r.status === 'matched')
    .map((r) => ({
      itemId: r.itemId,
      fields: r.changes.filter((c) => c.defaultSelected).map((c) => c.field),
    }))
    .filter((s) => s.fields.length);
  const selections = selected === undefined ? defaults : parseGplSelections(selected);
  const preview: GplUpdatePreview = {
    version: snapshot.version,
    target: {
      id: target.id,
      revision: target.revision,
      checksum: target.checksum,
      filename: target.filename,
      vendorId: target.profile.vendorId,
    },
    rows,
    selections,
    totals: { before: summarizeSpecification(snapshot), after: [] },
    warnings: [
      'Обновляются только выбранные поля сохраненных позиций. Количество, ручные решения и отсутствующие позиции сохраняются; новые позиции не добавляются.',
      'Цены разных валют не конвертируются и не суммируются вместе. Неизвестные цены и количества отмечены отдельно.',
    ],
  };
  if (
    target.rows.some((r) => r.status !== 'accepted') ||
    target.profile.endRow !== null ||
    target.profile.startRow !== target.profile.headerRow + 1 ||
    target.sheets.length > 1
  )
    preview.warnings.push(
      'Новый GPL подтвержден частично или ограничен выбранным листом/диапазоном. Отсутствие позиции не доказывает прекращение поставки.',
    );
  if (rows.some((r) => r.changes.some((c) => c.field === 'unit')))
    preview.warnings.push(
      'Смена единицы сохраняет количество. Проверьте смысл количества после обновления.',
    );
  preview.totals.after = summarizeSpecification(
    applyGplUpdateSelections(snapshot, preview, selections),
  );
  return preview;
}
interface Expected {
  version: number;
  targetRevision: number;
  targetChecksum: string;
}
async function prepare(
  calculationId: string,
  targetImportId: string,
  selected?: GplUpdateSelection[],
  expected?: Expected,
) {
  targetImportId = text(targetImportId, 'Новый GPL', 100, true);
  const saved = await loadSpecification(calculationId);
  if (!saved) throw new SpecificationError('Сначала сохраните спецификацию', 409);
  const target = await loadImport(targetImportId);
  if (
    expected &&
    (saved.snapshot.version !== expected.version ||
      target.revision !== expected.targetRevision ||
      target.checksum !== expected.targetChecksum)
  )
    throw new SpecificationError('Спецификация или GPL изменены. Обновите предпросмотр.', 409);
  const cache = new Map<string, Promise<ImportDraft | null>>();
  const resolveSource = (source: SpecificationImportOrigin) => {
    const key = JSON.stringify([source.importId, source.revision]);
    if (!cache.has(key))
      cache.set(
        key,
        loadImport(source.importId, source.revision).catch((e) => {
          if (e instanceof SpecificationError && e.statusCode === 404) return null;
          throw e;
        }),
      );
    return cache.get(key)!;
  };
  const preview = await buildGplUpdatePreview(saved.snapshot, target, resolveSource, selected);
  return { saved, preview };
}
export async function previewGplUpdate(
  calculationId: string,
  targetImportId: string,
  selections?: GplUpdateSelection[],
  expected?: Expected,
) {
  return (await prepare(calculationId, targetImportId, selections, expected)).preview;
}
export async function applyGplUpdate(calculationId: string, input: unknown, actorId: string) {
  const d = object(input),
    version = revision(d.version),
    targetRevision = revision(d.targetRevision),
    targetChecksum = text(d.targetChecksum, 'SHA-256', 64, true);
  const selections = parseGplSelections(d.selections);
  if (!selections.length) throw new SpecificationError('Выберите поля обновления');
  const { saved, preview } = await prepare(
    calculationId,
    text(d.targetImportId, 'Новый GPL', 100, true),
    selections,
    { version, targetRevision, targetChecksum },
  );
  const next = applyGplUpdateSelections(saved.snapshot, preview, selections);
  return saveSpecification(calculationId, next, actorId, { allowOriginUpdates: true });
}
