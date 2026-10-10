import { randomUUID } from 'node:crypto';
import { analyzeImport } from '../catalog/import-parser';
import { productInput } from '../catalog/validation';
import type { ImportProfile, ImportRow } from '../catalog/import-types';
import { ITEM_KINDS, type SpecificationItem } from './types';
import {
  BOM_FIELDS,
  type BomField,
  type BomPreview,
  type BomProfile,
  type BomRow,
} from './bom-types';
export { BOM_FIELDS, mergeBomRows } from './bom-types';
export type { BomField, BomPreview, BomProfile, BomRow } from './bom-types';
import { isDecimal, parseSpecification, SpecificationError } from './validation';

const KIND_ALIASES: Record<string, SpecificationItem['kind']> = {
  оборудование: 'hardware',
  по: 'software',
  'программное обеспечение': 'software',
  лицензия: 'license',
  поддержка: 'support',
  услуга: 'service',
  другое: 'other',
  прочее: 'other',
};

function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new SpecificationError('Требуется профиль импорта');
  return input as Record<string, unknown>;
}

export function parseBomProfile(input: unknown): BomProfile {
  const d = record(input),
    m = record(d.mapping ?? {});
  const row = (v: unknown, fallback: number) => {
    const n = v ?? fallback;
    if (!Number.isSafeInteger(n) || Number(n) < 1 || Number(n) > 10001)
      throw new SpecificationError('Номер строки: 1–10001');
    return Number(n);
  };
  if (Object.keys(m).some((k) => !(BOM_FIELDS as readonly string[]).includes(k)))
    throw new SpecificationError('Неизвестное поле сопоставления');
  const mapping: BomProfile['mapping'] = {};
  for (const field of BOM_FIELDS)
    if (m[field] !== undefined && m[field] !== null) {
      if (!Number.isSafeInteger(m[field]) || Number(m[field]) < 0 || Number(m[field]) > 99)
        throw new SpecificationError('Колонка: 0–99');
      mapping[field] = Number(m[field]);
    }
  const headerRow = row(d.headerRow, 1),
    startRow = row(d.startRow, headerRow + 1),
    endRow = d.endRow == null ? null : row(d.endRow, 10001);
  if (startRow <= headerRow || (endRow !== null && endRow < startRow))
    throw new SpecificationError('Диапазон должен начинаться после заголовка');
  const delimiter = String(d.delimiter ?? ';'),
    decimalSeparator = String(d.decimalSeparator ?? '.');
  if (![',', ';', '\t'].includes(delimiter) || !['.', ','].includes(decimalSeparator))
    throw new SpecificationError('Некорректный разделитель');
  const kind = d.kind ?? 'other';
  if (!(ITEM_KINDS as readonly unknown[]).includes(kind))
    throw new SpecificationError('Некорректный тип по умолчанию');
  const currency = String(d.currency ?? 'RUB');
  if (!/^[A-Z]{3}$/.test(currency)) throw new SpecificationError('Валюта: 3 заглавные буквы');
  const sheet = d.sheet ?? '';
  if (typeof sheet !== 'string' || sheet.length > 200)
    throw new SpecificationError('Некорректный лист');
  return {
    sheet,
    headerRow,
    startRow,
    endRow,
    delimiter: delimiter as BomProfile['delimiter'],
    decimalSeparator: decimalSeparator as BomProfile['decimalSeparator'],
    currency,
    kind: kind as BomProfile['kind'],
    mapping,
  };
}

/**
 * Exact decimal from a cell. XLSX numeric cells arrive as the OOXML lexical value
 * (possibly with exponent), CSV cells as typed text; no floating-point round trip.
 */
export function exactDecimal(raw: string, separator: '.' | ','): string | null {
  let value = raw.replace(/[\s ]/g, '');
  if (!value) return null;
  if (separator === ',') value = value.replace(',', '.');
  const match = /^(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d{1,5}))?$/.exec(value);
  if (!match) throw new SpecificationError(`«${raw}»: требуется неотрицательное десятичное число`);
  const whole = match[1] ?? '',
    fraction = match[2] ?? match[3] ?? '',
    exponent = Number(match[4] ?? '0');
  const digits = (whole + fraction).replace(/^0+/, '');
  const leading = (whole + fraction).length - digits.length;
  const significant = digits.replace(/0+$/, '');
  if (!significant) return '0';
  const point = whole.length - leading + exponent;
  const decimal =
    point <= 0
      ? `0.${'0'.repeat(Math.min(-point, 20))}${significant}`
      : point >= significant.length
        ? significant + '0'.repeat(Math.min(point - significant.length, 20))
        : `${significant.slice(0, point)}.${significant.slice(point)}`;
  if (!isDecimal(decimal))
    throw new SpecificationError(`«${raw}»: до 12 целых и 6 дробных цифр без потери точности`);
  return decimal;
}

function kindOf(value: string, fallback: SpecificationItem['kind']): SpecificationItem['kind'] {
  if (!value) return fallback;
  const key = value.trim().toLowerCase();
  if ((ITEM_KINDS as readonly string[]).includes(key)) return key as SpecificationItem['kind'];
  const alias = KIND_ALIASES[key];
  if (!alias) throw new SpecificationError(`Неизвестный тип позиции «${value}»`);
  return alias;
}

/** Message the catalog parser emits for a row without a mapped name; anything else is structural. */
const MISSING_NAME_ERROR = (() => {
  try {
    productInput({
      vendorId: 'bom',
      name: '',
      sku: '',
      edition: '',
      kind: 'other',
      unit: 'шт.',
      licensing: '',
      attributes: [],
    });
  } catch (error) {
    return (error as Error).message;
  }
  return '';
})();

/**
 * Reuses the GPL parser for bounded XLSX/CSV reading, archive checks, formula/error
 * cell detection and lexical numeric values. The catalog parser runs with only the
 * numeric column mapped: rows that reach its name check are structurally sound and
 * are then mapped onto specification fields here. Nothing is saved.
 */
const HEADER_PATTERNS: Array<[BomField, RegExp]> = [
  ['sku', /артикул|sku|p\/n|part ?(number|no)|партномер/i],
  ['vendor', /вендор|производител|vendor|manufacturer|бренд/i],
  ['quantity', /кол-?во|количеств|qty|quantity/i],
  ['unitPrice', /цена|price|стоимость за/i],
  ['currency', /валют|currency/i],
  ['unit', /^ед|единиц|unit$|uom/i],
  ['kind', /^тип|kind|type|категори/i],
  ['licensing', /лиценз|licens/i],
  ['term', /срок|гаранти|term|warranty/i],
  ['configuration', /характеристик|конфигурац|configuration|описание|description/i],
  ['source', /источник|source/i],
  ['rationale', /основани|обоснован|rationale/i],
  ['name', /наименован|название|name|позиция|товар/i],
];

/** Suggests a mapping from header captions; every column maps to at most one field. */
export function guessBomMapping(headers: string[]): BomProfile['mapping'] {
  const mapping: BomProfile['mapping'] = {};
  const used = new Set<number>();
  for (const [field, pattern] of HEADER_PATTERNS) {
    const index = headers.findIndex((h, i) => !used.has(i) && pattern.test(String(h).trim()));
    if (index >= 0 && index <= 99) {
      mapping[field] = index;
      used.add(index);
    }
  }
  return mapping;
}

export function analyzeBom(bytes: Uint8Array, filename: string, input: BomProfile): BomPreview {
  let profile = input;
  const pass = (column: number | undefined) =>
    analyzeImport(bytes, filename, {
      vendorId: 'bom',
      sheet: profile.sheet,
      headerRow: profile.headerRow,
      startRow: profile.startRow,
      endRow: profile.endRow,
      delimiter: profile.delimiter,
      decimalSeparator: profile.decimalSeparator,
      currency: profile.currency,
      kind: profile.kind,
      mapping: column === undefined ? {} : { unitPrice: column },
    } satisfies ImportProfile);
  if (!Object.keys(profile.mapping).length)
    profile = { ...profile, mapping: guessBomMapping(pass(undefined).headers.map(String)) };
  const priced = pass(profile.mapping.unitPrice);
  const quantities =
    profile.mapping.quantity === undefined
      ? null
      : new Map(pass(profile.mapping.quantity).rows.map((r) => [r.rowNumber, r]));
  const structural = (row: ImportRow | undefined) =>
    row ? row.errors.filter((e) => e !== MISSING_NAME_ERROR) : [];

  const rows: BomRow[] = priced.rows.map((source) => {
    const errors = [...structural(source)];
    const quantityRow = quantities?.get(source.rowNumber);
    for (const e of structural(quantityRow)) if (!errors.includes(e)) errors.push(e);
    const cell = (field: BomField, raw = source.raw) =>
      profile.mapping[field] === undefined ? '' : (raw[profile.mapping[field]!] ?? '').trim();
    let item: SpecificationItem | null = null;
    if (!errors.length) {
      try {
        if (profile.mapping.name === undefined)
          throw new SpecificationError('Сопоставьте колонку наименования');
        const name = cell('name');
        if (!name) throw new SpecificationError('Наименование обязательно');
        const currency = (cell('currency') || profile.currency).toUpperCase();
        if (!/^[A-Z]{3}$/.test(currency))
          throw new SpecificationError(`Валюта «${currency}»: код из 3 латинских букв`);
        const quantity = exactDecimal(
          cell('quantity', quantityRow?.raw ?? source.raw),
          profile.decimalSeparator,
        );
        const unitPrice = exactDecimal(cell('unitPrice'), profile.decimalSeparator);
        const candidate: SpecificationItem = {
          id: randomUUID(),
          kind: kindOf(cell('kind'), profile.kind),
          disposition: 'supply',
          name,
          vendor: cell('vendor'),
          sku: cell('sku'),
          quantity,
          unit: cell('unit') || 'шт.',
          configuration: cell('configuration'),
          licensing: cell('licensing'),
          term: cell('term'),
          source: cell('source') || `${filename} · ${source.sheet} · строка ${source.rowNumber}`,
          rationale: cell('rationale'),
          confirmed: false,
          unitPrice,
          currency,
        };
        // The same strict validation as a saved revision (field lengths, decimals).
        item = parseSpecification({
          version: 0,
          status: 'draft',
          emptySupplyReason: '',
          items: [candidate],
        }).items[0];
      } catch (error) {
        if (!(error instanceof SpecificationError)) throw error;
        errors.push(error.message);
      }
    }
    return {
      id: source.id,
      sheet: source.sheet,
      rowNumber: source.rowNumber,
      raw: source.raw,
      item: errors.length ? null : item,
      errors,
    };
  });
  return {
    filename,
    sheets: priced.sheets,
    headers: priced.headers,
    profile: { ...profile, sheet: priced.profile.sheet },
    rows,
  };
}
