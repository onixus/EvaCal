import {
  GPL_UPDATE_FIELDS,
  type SpecificationCatalogOrigin,
  type SpecificationImportOrigin,
} from './gpl-update-types';
import {
  ITEM_KINDS,
  ITEM_DISPOSITIONS,
  LICENSED_KINDS,
  SPECIFICATION_STATUSES,
  type SpecificationSizingRef,
  FINAL_SPECIFICATION_STATUSES,
  SpecificationItem,
  SpecificationSnapshot,
  type SpecificationExchangeRate,
} from './types';
import { parseEvidenceSnapshot } from '../catalog/compliance';

export class SpecificationError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
  }
}

function parseEvidenceList(value: unknown) {
  if (!Array.isArray(value) || value.length > 50)
    throw new SpecificationError('Подтверждения соответствия: список до 50 записей');
  return value.map(parseEvidenceSnapshot);
}

export function isDecimal(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9]\d{0,11})(\.\d{1,6})?$/.test(value);
}

function text(value: unknown, field: string, max = 2000): string {
  if (typeof value !== 'string' || value.length > max) {
    throw new SpecificationError(`Некорректное поле «${field}» (до ${max} символов)`);
  }
  return value.trim();
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new SpecificationError(`Некорректное поле ${field}`);
  return value as Record<string, unknown>;
}
function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some((k) => !allowed.includes(k)))
    throw new SpecificationError('Неизвестное поле происхождения');
}
export function parseImportOrigin(input: unknown): SpecificationImportOrigin {
  const d = record(input, 'GPL');
  onlyKeys(d, ['importId', 'revision', 'checksum', 'sheet', 'rowNumber']);
  const importId = text(d.importId, 'GPL ID', 100),
    sheet = text(d.sheet, 'Лист', 200),
    checksum = text(d.checksum, 'SHA-256', 64);
  if (
    !importId ||
    !sheet ||
    !/^[a-f0-9]{64}$/.test(checksum) ||
    !Number.isSafeInteger(d.revision) ||
    Number(d.revision) < 1 ||
    !Number.isSafeInteger(d.rowNumber) ||
    Number(d.rowNumber) < 1 ||
    Number(d.rowNumber) > 10001
  )
    throw new SpecificationError('Некорректное происхождение GPL');
  return {
    importId,
    revision: Number(d.revision),
    checksum,
    sheet,
    rowNumber: Number(d.rowNumber),
  };
}
export function parseCatalogOrigin(input: unknown): SpecificationCatalogOrigin {
  const d = record(input, 'Каталог');
  onlyKeys(d, [
    'vendorId',
    'vendorName',
    'productId',
    'productRevision',
    'offerId',
    'sku',
    'edition',
    'import',
    'baseline',
    'fieldSources',
  ]);
  const vendorId = text(d.vendorId, 'Вендор ID', 100),
    vendorName = text(d.vendorName, 'Исходное название вендора', 200),
    productId = text(d.productId, 'Позиция ID', 100),
    sku = text(d.sku, 'Артикул', 200),
    edition = text(d.edition, 'Редакция', 200);
  const offerId = d.offerId === null ? null : text(d.offerId, 'Предложение ID', 100);
  if (
    !vendorId ||
    !vendorName ||
    !productId ||
    (offerId !== null && !offerId) ||
    !Number.isSafeInteger(d.productRevision) ||
    Number(d.productRevision) < 1
  )
    throw new SpecificationError('Некорректное происхождение каталога');
  const b = record(d.baseline, 'Исходные поля');
  onlyKeys(b, GPL_UPDATE_FIELDS);
  if (
    !(ITEM_KINDS as readonly unknown[]).includes(b.kind) ||
    (b.unitPrice !== null && !isDecimal(b.unitPrice))
  )
    throw new SpecificationError('Некорректная исходная цена или тип');
  const currency = text(b.currency, 'Исходная валюта', 3);
  if (currency && !/^[A-Z]{3}$/.test(currency))
    throw new SpecificationError('Некорректная исходная валюта');
  const baseline = {
    name: text(b.name, 'Исходное название'),
    kind: String(b.kind),
    unit: text(b.unit, 'Исходная единица', 100),
    configuration: text(b.configuration, 'Исходные характеристики'),
    licensing: text(b.licensing, 'Исходное лицензирование'),
    term: text(b.term, 'Исходный срок'),
    source: text(b.source, 'Исходный источник'),
    unitPrice: b.unitPrice as string | null,
    currency,
  };
  let fieldSources: SpecificationCatalogOrigin['fieldSources'];
  if (d.fieldSources !== undefined) {
    const fields = record(d.fieldSources, 'Источники полей');
    onlyKeys(fields, GPL_UPDATE_FIELDS);
    fieldSources = {};
    for (const key of GPL_UPDATE_FIELDS)
      if (fields[key] !== undefined) fieldSources[key] = parseImportOrigin(fields[key]);
  }
  return {
    vendorId,
    vendorName,
    productId,
    productRevision: Number(d.productRevision),
    offerId,
    sku,
    edition,
    import: d.import === null ? null : parseImportOrigin(d.import),
    baseline,
    ...(fieldSources === undefined ? {} : { fieldSources }),
  };
}

const SIZING_KEY = /^[a-z][a-z0-9_]{0,63}$/;
export function parseSizingRef(input: unknown): SpecificationSizingRef {
  const d = record(input, 'Связь с сайзингом');
  onlyKeys(d, ['runId', 'metric', 'scenario', 'requiredQuantity', 'unitCapacity']);
  const runId = text(d.runId, 'Прогон сайзинга', 100);
  if (!runId) throw new SpecificationError('Некорректная связь с сайзингом');
  if (typeof d.metric !== 'string' || !SIZING_KEY.test(d.metric))
    throw new SpecificationError('Некорректная метрика сайзинга');
  if (d.scenario !== undefined && (typeof d.scenario !== 'string' || !SIZING_KEY.test(d.scenario)))
    throw new SpecificationError('Некорректный сценарий сайзинга');
  if (!isDecimal(d.requiredQuantity))
    throw new SpecificationError('Потребность сайзинга: неотрицательное десятичное число');
  if (d.unitCapacity !== undefined && (!isDecimal(d.unitCapacity) || Number(d.unitCapacity) <= 0))
    throw new SpecificationError('Ёмкость единицы позиции: положительное десятичное число');
  return {
    runId,
    metric: d.metric,
    ...(d.scenario === undefined || d.scenario === 'base'
      ? {}
      : { scenario: d.scenario as string }),
    requiredQuantity: d.requiredQuantity,
    ...(d.unitCapacity === undefined ? {} : { unitCapacity: d.unitCapacity as string }),
  };
}

/** Strict input validation also applies to reloaded snapshots and direct generation. */
export function parseSpecification(input: unknown): SpecificationSnapshot {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new SpecificationError('Требуется спецификация');
  }
  const data = input as Record<string, unknown>;
  if (!Number.isSafeInteger(data.version) || Number(data.version) < 0) {
    throw new SpecificationError('Некорректная версия');
  }
  if (!(SPECIFICATION_STATUSES as readonly unknown[]).includes(data.status)) {
    throw new SpecificationError('Некорректный статус');
  }
  if (!Array.isArray(data.items) || data.items.length > 500) {
    throw new SpecificationError('Допускается до 500 позиций');
  }
  const ids = new Set<string>();
  const items: SpecificationItem[] = data.items.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new SpecificationError('Некорректная строка');
    }
    const row = raw as Record<string, unknown>;
    if (row.priceOverride !== undefined && typeof row.priceOverride !== 'boolean')
      throw new SpecificationError('Ручная цена: требуется логическое значение');
    const id = text(row.id, 'id', 100);
    if (!id || ids.has(id)) throw new SpecificationError('ID строк должны быть уникальными');
    ids.add(id);
    if (
      !(ITEM_KINDS as readonly unknown[]).includes(row.kind) ||
      !(ITEM_DISPOSITIONS as readonly unknown[]).includes(row.disposition) ||
      typeof row.confirmed !== 'boolean'
    ) {
      throw new SpecificationError('Некорректный тип, назначение или подтверждение строки');
    }
    if (row.quantity !== null && !isDecimal(row.quantity)) {
      throw new SpecificationError('Количество: неотрицательное десятичное число или неизвестно');
    }
    if (row.unitPrice !== null && !isDecimal(row.unitPrice)) {
      throw new SpecificationError('Цена: неотрицательное десятичное число или неизвестно');
    }
    const currency = text(row.currency, 'Валюта', 3);
    if (currency && !/^[A-Z]{3}$/.test(currency))
      throw new SpecificationError('Валюта: код из 3 букв');
    const changeReason =
      row.changeReason === undefined ? '' : text(row.changeReason, 'Причина изменения', 1000);
    const includedIn =
      row.includedIn === undefined || row.includedIn === null || row.includedIn === ''
        ? ''
        : text(row.includedIn, 'Входит в комплект', 100);
    if (
      row.perBundle !== undefined &&
      (!includedIn || !isDecimal(row.perBundle) || !/[1-9]/.test(row.perBundle))
    )
      throw new SpecificationError(
        'Количество на комплект: положительное число только для компонента комплекта',
      );
    return {
      id,
      ...(row.origin === undefined ? {} : { origin: parseCatalogOrigin(row.origin) }),
      ...(row.sizingRef === undefined ? {} : { sizingRef: parseSizingRef(row.sizingRef) }),
      ...(row.priceOverride === undefined ? {} : { priceOverride: row.priceOverride as boolean }),
      kind: row.kind as SpecificationItem['kind'],
      disposition: row.disposition as SpecificationItem['disposition'],
      name: text(row.name, 'Название'),
      vendor: text(row.vendor, 'Вендор'),
      sku: text(row.sku, 'Артикул'),
      quantity: row.quantity as string | null,
      unit: text(row.unit, 'Единица', 100),
      configuration: text(row.configuration, 'Характеристики'),
      licensing: text(row.licensing, 'Лицензирование'),
      term: text(row.term, 'Срок'),
      source: text(row.source, 'Источник'),
      rationale: text(row.rationale, 'Основание'),
      confirmed: row.confirmed,
      unitPrice: row.unitPrice as string | null,
      ...parsePriceSplit(row),
      currency,
      ...(changeReason ? { changeReason } : {}),
      ...(includedIn ? { includedIn } : {}),
      ...(row.perBundle === undefined ? {} : { perBundle: row.perBundle as string }),
      ...(row.evidence === undefined ? {} : { evidence: parseEvidenceList(row.evidence) }),
    };
  });
  let sizingRunIds: string[] | undefined;
  if (data.sizingRunIds !== undefined) {
    if (!Array.isArray(data.sizingRunIds) || data.sizingRunIds.length > 500)
      throw new SpecificationError('Некорректный список прогонов сайзинга');
    sizingRunIds = data.sizingRunIds.map((id) => text(id, 'Прогон сайзинга', 100));
  }
  // Bundle composition: one level, the parent is a bundle row of this snapshot.
  const byId = new Map(items.map((item) => [item.id, item]));
  for (const item of items) {
    if (!item.includedIn) continue;
    const parent = byId.get(item.includedIn);
    if (!parent || parent.id === item.id || parent.kind !== 'bundle' || parent.includedIn)
      throw new SpecificationError(
        `${item.name || item.id}: «входит в комплект» должно ссылаться на строку-комплект этой спецификации`,
      );
    if (item.kind === 'bundle')
      throw new SpecificationError(
        `${item.name || item.id}: вложенные комплекты не поддерживаются`,
      );
  }
  return {
    version: Number(data.version),
    status: data.status as SpecificationSnapshot['status'],
    emptySupplyReason: text(data.emptySupplyReason, 'Причина отсутствия поставки'),
    items,
    ...(sizingRunIds === undefined ? {} : { sizingRunIds }),
    ...parseSnapshotExchangeRates(data.exchangeRates),
  };
}

const PERCENT_RE = /^(100(\.0{1,6})?|[1-9]?\d(\.\d{1,6})?)$/;
export const RATE_RE = /^(0|[1-9]\d{0,9})(\.\d{1,8})?$/;

/** #101 §3: optional price split of a row; empty/null/undefined — field not set. */
export function parsePriceSplit(
  row: Record<string, unknown>,
): Pick<SpecificationItem, 'purchasePrice' | 'salePrice' | 'discountPercent' | 'vatRate'> {
  const out: Pick<
    SpecificationItem,
    'purchasePrice' | 'salePrice' | 'discountPercent' | 'vatRate'
  > = {};
  const fields = [
    ['purchasePrice', 'Цена закупки', isDecimal],
    ['salePrice', 'Цена продажи', isDecimal],
    [
      'discountPercent',
      'Скидка строки, %',
      (v: unknown) => typeof v === 'string' && PERCENT_RE.test(v),
    ],
    [
      'vatRate',
      'Ставка НДС строки, %',
      (v: unknown) => typeof v === 'string' && PERCENT_RE.test(v),
    ],
  ] as const;
  for (const [key, label, valid] of fields) {
    const value = row[key];
    if (value === undefined || value === null || value === '') continue;
    if (!valid(value)) throw new SpecificationError(`${label}: неотрицательное десятичное число`);
    out[key] = value as string;
  }
  return out;
}

/** #101 §3: курсы пересчёта снимка; пара валют встречается не более одного раза. */
export function parseSnapshotExchangeRates(input: unknown): {
  exchangeRates?: SpecificationExchangeRate[];
} {
  if (input === undefined || input === null) return {};
  if (!Array.isArray(input) || input.length > 50)
    throw new SpecificationError('Курсы пересчёта: список до 50 пар валют');
  const seen = new Set<string>();
  const rates = input.map((raw: unknown) => {
    const r = record(raw, 'курса');
    const from = text(r.from, 'Курс: из валюты', 3);
    const to = text(r.to, 'Курс: в валюту', 3);
    if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to) || from === to)
      throw new SpecificationError('Курс: две разные валюты, коды из 3 букв');
    if (typeof r.rate !== 'string' || !RATE_RE.test(r.rate) || !/[1-9]/.test(r.rate))
      throw new SpecificationError(`Курс ${from}→${to}: положительное число, до 8 знаков`);
    const date = text(r.date, 'Дата курса', 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)))
      throw new SpecificationError(`Курс ${from}→${to}: дата ГГГГ-ММ-ДД`);
    const source = text(r.source, 'Источник курса', 200);
    if (!source) throw new SpecificationError(`Курс ${from}→${to}: укажите источник`);
    const key = `${from}>${to}`;
    if (seen.has(key)) throw new SpecificationError(`Курс ${from}→${to} указан дважды`);
    seen.add(key);
    const rateId = r.rateId === undefined ? '' : text(r.rateId, 'ID курса', 100);
    return { from, to, rate: r.rate, date, source, ...(rateId ? { rateId } : {}) };
  });
  return rates.length ? { exchangeRates: rates } : {};
}

export function specificationBlockers(spec?: SpecificationSnapshot): string[] {
  if (!spec) return ['Состав поставки не задан. Создайте и подтвердите спецификацию.'];
  const problems: string[] = [];
  if (!FINAL_SPECIFICATION_STATUSES.includes(spec.status))
    problems.push('Версия спецификации не подтверждена.');
  if (spec.items.length === 0 && !spec.emptySupplyReason) {
    problems.push('Подтвердите отсутствие поставки с указанием причины.');
  }
  for (const item of spec.items) {
    const prefix = item.name || item.id;
    if (item.disposition === 'alternative') {
      problems.push(`${prefix}: выберите альтернативу или удалите ее перед подтверждением.`);
      continue;
    }
    if (
      !item.name ||
      !item.unit ||
      !item.source ||
      !item.rationale ||
      item.quantity === null ||
      Number(item.quantity) <= 0 ||
      !item.confirmed
    ) {
      problems.push(
        `${prefix}: нужны название, положительное количество, единица, источник, основание и подтверждение.`,
      );
    }
    if (LICENSED_KINDS.includes(item.kind) && !item.licensing) {
      problems.push(
        `${prefix}: укажите модель лицензирования или право использования имеющегося ПО.`,
      );
    }
    if (item.unitPrice !== null && !item.currency) problems.push(`${prefix}: укажите валюту цены.`);
  }
  return problems;
}

export function requireConfirmedSpecification(spec?: SpecificationSnapshot): void {
  const parsed = spec && parseSpecification(spec);
  const blockers = specificationBlockers(parsed);
  if (blockers.length) throw new SpecificationError(blockers.join('\n'), 409);
}
