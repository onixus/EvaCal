import * as XLSX from 'xlsx';
import { xml2js, type Element } from 'xml-js';
import { posix } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { SpecificationError } from '../specification/validation';
import { object, text, productInput, offerInput } from './validation';
import { IMPORT_FIELDS, type ImportProfile, type ImportRow } from './import-types';
import { ITEM_KINDS } from '../specification/types';
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export function importProfile(input: unknown): ImportProfile {
  const d = object(input),
    m = object(d.mapping ?? {});
  const integer = (v: unknown, fallback: number) => {
    const n = v ?? fallback;
    if (!Number.isSafeInteger(n) || Number(n) < 1 || Number(n) > 10001)
      throw new SpecificationError('Номер строки: 1–10001');
    return Number(n);
  };
  if (
    !['.', ','].includes(String(d.decimalSeparator ?? '.')) ||
    ![',', ';', '\t'].includes(String(d.delimiter ?? ';'))
  )
    throw new SpecificationError('Некорректный разделитель');
  const mapping: ImportProfile['mapping'] = {};
  for (const field of IMPORT_FIELDS)
    if (m[field] !== undefined) {
      if (!Number.isSafeInteger(m[field]) || Number(m[field]) < 0 || Number(m[field]) > 99)
        throw new SpecificationError('Колонка: 0–99');
      mapping[field] = Number(m[field]);
    }
  const headerRow = integer(d.headerRow, 1),
    startRow = integer(d.startRow, headerRow + 1);
  const endRow = d.endRow == null ? null : integer(d.endRow, 10001);
  if (startRow <= headerRow || (endRow !== null && endRow < startRow))
    throw new SpecificationError('Диапазон должен начинаться после заголовка');
  const kind = d.kind ?? 'hardware';
  if (!(ITEM_KINDS as readonly unknown[]).includes(kind))
    throw new SpecificationError('Некорректный тип');
  const currency = text(d.currency ?? 'RUB', 'Валюта', 3, true);
  if (!/^[A-Z]{3}$/.test(currency)) throw new SpecificationError('Валюта: 3 заглавные буквы');
  return {
    vendorId: text(d.vendorId, 'Вендор', 100, true),
    sheet: text(d.sheet ?? '', 'Лист'),
    headerRow,
    startRow,
    endRow,
    delimiter: (d.delimiter ?? ';') as ImportProfile['delimiter'],
    decimalSeparator: (d.decimalSeparator ?? '.') as ImportProfile['decimalSeparator'],
    currency,
    kind: kind as ImportProfile['kind'],
    mapping,
  };
}
function csvRows(content: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    value = '',
    quoted = false,
    closed = false;
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (closed && c !== delimiter && c !== '\n' && c !== '\r')
      throw new SpecificationError('Некорректный символ после закрывающих кавычек CSV');
    if (c === '"') {
      if (quoted && content[i + 1] === '"') {
        value += '"';
        i++;
      } else if (quoted) {
        quoted = false;
        closed = true;
      } else if (!value) quoted = true;
      else throw new SpecificationError('Некорректные кавычки CSV');
    } else if (!quoted && (c === delimiter || c === '\n' || c === '\r')) {
      row.push(value);
      value = '';
      closed = false;
      if (c !== delimiter) {
        rows.push(row);
        row = [];
        if (c === '\r' && content[i + 1] === '\n') i++;
      }
    } else value += c;
    if (rows.length > 10001 || row.length > 100 || value.length > 10000)
      throw new SpecificationError('До 10000 строк данных, 100 колонок и 10000 символов в ячейке');
  }
  if (quoted) throw new SpecificationError('Незакрытые кавычки CSV');
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}
export function analyzeImport(bytes: Uint8Array, filename: string, profile: ImportProfile) {
  if (!bytes.length || bytes.length > MAX_IMPORT_BYTES)
    throw new SpecificationError('Размер GPL: от 1 байта до 5 МБ');
  let sheets: string[], cells: string[][];
  const formulas = new Set<number>();
  const cellErrors = new Map<number, string[]>();
  let numericPrices = new Map<number, { raw: string; error?: string }>();
  if (/\.csv$/i.test(filename)) {
    sheets = ['CSV'];
    cells = csvRows(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''),
      profile.delimiter,
    );
  } else if (/\.xlsx$/i.test(filename)) {
    validateXlsxArchive(bytes);
    const workbook = XLSX.read(bytes, {
      type: 'array',
      sheetRows: 10002,
      cellFormula: true,
      cellNF: true,
      bookFiles: true,
      cellHTML: false,
      cellStyles: false,
    });
    sheets = workbook.SheetNames;
    const chosen = profile.sheet || sheets[0];
    if (!sheets.includes(chosen)) throw new SpecificationError('Лист не найден');
    const ws = workbook.Sheets[chosen];
    if (!ws) throw new SpecificationError('Не удалось прочитать лист XLSX');
    // Validate dimensions before materializing the rectangular row array. SheetJS
    // retains the original dimension in !fullref when sheetRows truncates input.
    const physicalRange = XLSX.utils.decode_range(ws['!fullref'] ?? ws['!ref'] ?? 'A1');
    if (
      physicalRange.s.r < 0 ||
      physicalRange.s.c < 0 ||
      physicalRange.e.r > 10000 ||
      physicalRange.e.c > 99 ||
      physicalRange.s.r > physicalRange.e.r ||
      physicalRange.s.c > physicalRange.e.c
    )
      throw new SpecificationError('До 10000 строк данных и 100 колонок');

    if (profile.mapping.unitPrice !== undefined)
      numericPrices = lexicalPrices(workbook, chosen, profile.mapping.unitPrice, physicalRange.e);
    // Walk the bounded physical rectangle so error cells are retained (the
    // SheetJS JSON converter otherwise replaces them with empty values).
    // Text identities use Excel's displayed formatting; monetary values use
    // the numeric source value, independently of display rounding.
    cells = [];
    for (let r = 0; r <= physicalRange.e.r; r++) {
      const row: string[] = [];
      for (let c = 0; c <= physicalRange.e.c; c++) {
        const address = XLSX.utils.encode_cell({ r, c });
        const cell = ws[address] as XLSX.CellObject | undefined;
        if (cell?.f) formulas.add(r);
        if (cell?.t === 'e') {
          const token = XLSX.utils.format_cell(cell);
          const errors = cellErrors.get(r) ?? [];
          errors.push(`${address}: ${token}`);
          cellErrors.set(r, errors);
          row.push(token);
        } else if (cell?.t === 'n' && c === profile.mapping.unitPrice) {
          if (!numericPrices.has(r))
            numericPrices.set(r, {
              raw: '',
              error: `Не найдено исходное числовое значение ${address}: требуется исправление XLSX`,
            });
          row.push(numericPrices.get(r)!.raw);
        } else {
          row.push(cell ? XLSX.utils.format_cell(cell) : '');
        }
      }
      cells.push(row);
    }
  } else throw new SpecificationError('Поддерживаются XLSX и UTF-8 CSV');
  const sheet = profile.sheet || sheets[0];
  if (!sheets.includes(sheet)) throw new SpecificationError('Лист не найден');
  if (
    cells.length > 10001 ||
    cells.some((r) => r.length > 100 || r.some((c) => String(c).length > 10000))
  )
    throw new SpecificationError('До 10000 строк данных и 100 колонок');
  const rows: ImportRow[] = [],
    seen = new Set<string>();
  const effectiveProfile = { ...profile, sheet };
  for (
    let i = profile.startRow - 1;
    i < Math.min(cells.length, profile.endRow ?? cells.length);
    i++
  ) {
    const raw = (cells[i] ?? []).map(String);
    if (
      !raw.some((c) => c.trim()) &&
      !numericPrices.get(i)?.error &&
      !cellErrors.has(i) &&
      !formulas.has(i)
    )
      continue;
    const get = (f: (typeof IMPORT_FIELDS)[number]) =>
      profile.mapping[f] === undefined ? '' : (raw[profile.mapping[f]!] ?? '').trim();
    const errors: string[] = [];
    let normalized: ImportRow['normalized'] = null;
    try {
      const numericPrice = numericPrices.get(i);
      if (numericPrice?.error) throw new SpecificationError(numericPrice.error);
      if (cellErrors.has(i))
        throw new SpecificationError(
          `Строка содержит ошибку XLSX (${cellErrors.get(i)!.join('; ')}): требуется явное исправление значений`,
        );
      if (formulas.has(i))
        throw new SpecificationError(
          'Строка содержит формулу: требуется явное исправление значений',
        );
      const priceRaw = get('unitPrice');
      const price = numericPrice
        ? numericPrice.raw
          ? exactNumericPrice(numericPrice.raw)
          : null
        : priceRaw
          ? priceRaw.replace(/[\s\u00a0]/g, '').replace(profile.decimalSeparator, '.')
          : null;
      const product = productInput({
        vendorId: profile.vendorId,
        name: get('name'),
        sku: get('sku'),
        edition: get('edition'),
        kind: profile.kind,
        unit: get('unit'),
        licensing: get('licensing'),
        attributes: get('description')
          ? [{ name: 'Описание', value: get('description'), unit: '' }]
          : [],
      });
      if (!product.sku) throw new SpecificationError('Артикул обязателен для сопоставления GPL');
      const identity = JSON.stringify([product.sku, product.edition]);
      if (seen.has(identity))
        throw new SpecificationError('Дублирующийся артикул в выбранном диапазоне');
      seen.add(identity);
      const offer = offerInput({
        source: `${filename} · ${sheet} · строка ${i + 1}`,
        unitPrice: price,
        currency: get('currency') || profile.currency,
        region: '',
        terms: get('terms'),
        priceDate: null,
        validUntil: null,
      });
      normalized = { product, offer };
    } catch (e) {
      errors.push((e as Error).message);
    }
    rows.push({
      id: `${sheet}:${i + 1}`,
      sheet,
      rowNumber: i + 1,
      raw,
      normalized,
      errors,
      status: errors.length ? 'error' : 'ready',
    });
  }
  return { sheets, headers: cells[profile.headerRow - 1] ?? [], profile: effectiveProfile, rows };
}

type SourceWorkbook = XLSX.WorkBook & {
  Directory?: { workbooks?: string[] };
  files?: Record<string, { content?: Uint8Array | string }>;
};
const localName = (node: Element) => node.name?.split(':').pop();
const children = (node: Element, name: string) =>
  (node.elements ?? []).filter((child) => child.type === 'element' && localName(child) === name);
function sourceXml(workbook: SourceWorkbook, path: string): Element {
  const content = workbook.files?.[path]?.content;
  if (content === undefined) throw new SpecificationError('Исходная XML-часть XLSX не найдена');
  try {
    return xml2js(
      typeof content === 'string'
        ? content
        : new TextDecoder('utf-8', { fatal: true }).decode(content),
      { compact: false, nativeType: false },
    ) as Element;
  } catch {
    throw new SpecificationError('Некорректная XML-часть XLSX');
  }
}
function lexicalPrices(
  workbook: SourceWorkbook,
  chosen: string,
  column: number,
  end: { r: number; c: number },
) {
  const path = workbook.Directory?.workbooks?.[0]?.replace(/^\//, '');
  const sheets = workbook.Workbook?.Sheets as Array<{ name?: string; id?: string }> | undefined;
  const id = sheets?.find((sheet) => sheet.name === chosen)?.id;
  if (!path || !id) throw new SpecificationError('Не удалось определить исходный лист XLSX');
  const relPath = posix.join(posix.dirname(path), '_rels', `${posix.basename(path)}.rels`);
  const relRoot = children(sourceXml(workbook, relPath), 'Relationships')[0];
  const relationships = relRoot
    ? children(relRoot, 'Relationship').filter((rel) => rel.attributes?.Id === id)
    : [];
  if (relationships.length !== 1) throw new SpecificationError('Неоднозначная связь листа XLSX');
  const attrs = relationships[0].attributes;
  if (
    attrs?.TargetMode === 'External' ||
    !String(attrs?.Type).endsWith('/worksheet') ||
    typeof attrs?.Target !== 'string'
  )
    throw new SpecificationError('Некорректная связь листа XLSX');
  let target: string;
  try {
    target = decodeURIComponent(attrs.Target);
  } catch {
    throw new SpecificationError('Некорректный путь листа XLSX');
  }
  const sheetPath = posix.normalize(
    target.startsWith('/') ? target.slice(1) : posix.join(posix.dirname(path), target),
  );
  if (sheetPath.startsWith('../') || sheetPath.includes('\\'))
    throw new SpecificationError('Некорректный путь листа XLSX');
  const root = children(sourceXml(workbook, sheetPath), 'worksheet')[0];
  if (!root) throw new SpecificationError('Исходный лист XLSX не найден');
  const result = new Map<number, { raw: string; error?: string }>();
  const seen = new Set<number>();
  for (const data of children(root, 'sheetData'))
    for (const row of children(data, 'row'))
      for (const cell of children(row, 'c')) {
        const address = cell.attributes?.r;
        if (typeof address !== 'string' || !/^[A-Z]+[1-9]\d*$/.test(address))
          throw new SpecificationError('Некорректная координата ячейки XLSX');
        const coordinate = XLSX.utils.decode_cell(address);
        if (coordinate.c !== column) continue;
        if (coordinate.r > end.r || coordinate.c > end.c)
          throw new SpecificationError('Ячейка XLSX вне диапазона листа');
        if (seen.has(coordinate.r)) {
          result.set(coordinate.r, {
            raw: result.get(coordinate.r)?.raw ?? '',
            error: `Повторная ячейка ${address}: требуется исправление исходного XLSX`,
          });
          continue;
        }
        seen.add(coordinate.r);
        if (
          cell.attributes?.t !== undefined &&
          cell.attributes.t !== '' &&
          cell.attributes.t !== 'n'
        )
          continue;
        const values = children(cell, 'v');
        if (!values.length) {
          result.set(coordinate.r, { raw: '' });
          continue;
        }
        const nodes = values[0]?.elements ?? [];
        const raw = nodes
          .filter((node) => node.type === 'text')
          .map((node) => String(node.text ?? ''))
          .join('')
          .trim();
        if (
          values.length !== 1 ||
          nodes.some((node) => node.type !== 'text') ||
          !raw ||
          raw.length > 10000
        )
          result.set(coordinate.r, {
            raw,
            error: `Некорректное исходное числовое значение ${address}: требуется явное исправление`,
          });
        else result.set(coordinate.r, { raw });
      }
  return result;
}
// Convert the OOXML number's lexical representation without a floating-point
// round trip. Bound exponent and output before allocating zero padding.
function exactNumericPrice(raw: string): string {
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(raw);
  const invalid = () =>
    new SpecificationError('Цена XLSX: до 12 целых и 6 дробных цифр, без потери точности');
  if (!match || (match[5]?.length ?? 0) > 6) throw invalid();
  const exponent = BigInt(match[5] ?? '0');
  if (exponent < BigInt(-10000) || exponent > BigInt(10000)) throw invalid();
  const whole = match[2] ?? '',
    fraction = match[3] ?? match[4] ?? '';
  const sourceDigits = whole + fraction;
  const leading = sourceDigits.match(/^0*/)?.[0].length ?? 0;
  const digits = sourceDigits.slice(leading).replace(/0+$/, '');
  if (!digits) return '0';
  const point = BigInt(whole.length - leading) + exponent;
  if (point > BigInt(12) || BigInt(digits.length) - point > BigInt(6)) throw invalid();
  const p = Number(point);
  const decimal =
    p <= 0
      ? `0.${'0'.repeat(-p)}${digits}`
      : p >= digits.length
        ? digits + '0'.repeat(p - digits.length)
        : `${digits.slice(0, p)}.${digits.slice(p)}`;
  return match[1] === '-' ? `-${decimal}` : decimal;
}

// Inspect ZIP central directory sizes before handing compressed data to SheetJS.
// ZIP64, encryption and excessive inflation are outside the bounded v1 format.
function validateXlsxArchive(bytes: Uint8Array) {
  const b = Buffer.from(bytes);
  let end = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--)
    if (b.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new SpecificationError('Некорректный ZIP XLSX');
  const count = b.readUInt16LE(end + 10),
    offset = b.readUInt32LE(end + 16);
  if (
    count > 1000 ||
    offset >= end ||
    b.readUInt16LE(end + 4) !== 0 ||
    b.readUInt16LE(end + 6) !== 0
  )
    throw new SpecificationError('Неподдерживаемый архив XLSX');
  const spans: Array<{ start: number; end: number }> = [];
  let pos = offset,
    total = 0;
  for (let n = 0; n < count; n++) {
    if (pos + 46 > end || b.readUInt32LE(pos) !== 0x02014b50)
      throw new SpecificationError('Некорректный каталог ZIP');
    const size = b.readUInt32LE(pos + 24),
      compressed = b.readUInt32LE(pos + 20),
      flags = b.readUInt16LE(pos + 8);
    const method = b.readUInt16LE(pos + 10),
      local = b.readUInt32LE(pos + 42);
    if (
      local + 30 > offset ||
      b.readUInt32LE(local) !== 0x04034b50 ||
      b.readUInt16LE(local + 8) !== method ||
      b.readUInt16LE(local + 6) !== flags ||
      ![0, 8].includes(method)
    )
      throw new SpecificationError('Некорректная запись ZIP');
    const nameLength = b.readUInt16LE(pos + 28),
      localNameLength = b.readUInt16LE(local + 26);
    if (
      nameLength !== localNameLength ||
      !b
        .subarray(pos + 46, pos + 46 + nameLength)
        .equals(b.subarray(local + 30, local + 30 + localNameLength))
    )
      throw new SpecificationError('Несовпадающие имена ZIP');
    const payloadStart = local + 30 + localNameLength + b.readUInt16LE(local + 28);
    if (
      payloadStart + compressed > offset ||
      (!(flags & 8) &&
        (b.readUInt32LE(local + 18) !== compressed || b.readUInt32LE(local + 22) !== size))
    )
      throw new SpecificationError('Некорректные размеры ZIP');
    let payloadEnd = payloadStart + compressed;
    if (flags & 8) {
      const descriptor =
        payloadEnd +
        (payloadEnd + 4 <= offset && b.readUInt32LE(payloadEnd) === 0x08074b50 ? 4 : 0);
      if (
        descriptor + 12 > offset ||
        b.readUInt32LE(descriptor) !== b.readUInt32LE(pos + 16) ||
        b.readUInt32LE(descriptor + 4) !== compressed ||
        b.readUInt32LE(descriptor + 8) !== size
      )
        throw new SpecificationError('Некорректный дескриптор ZIP');
      payloadEnd = descriptor + 12;
    }
    spans.push({ start: local, end: payloadEnd });
    total += size;
    if (
      flags & 1 ||
      size === 0xffffffff ||
      total > 30 * 1024 * 1024 ||
      size > Math.max(1024 * 1024, compressed * 200)
    )
      throw new SpecificationError('Распакованный XLSX превышает допустимый размер');
    try {
      const payload = b.subarray(payloadStart, payloadStart + compressed);
      const inflated =
        method === 0 ? payload : inflateRawSync(payload, { maxOutputLength: Math.max(1, size) });
      if (inflated.length !== size) throw new Error('size');
    } catch {
      throw new SpecificationError('Некорректный или слишком большой распакованный XLSX');
    }
    pos += 46 + b.readUInt16LE(pos + 28) + b.readUInt16LE(pos + 30) + b.readUInt16LE(pos + 32);
  }
  if (pos !== end) throw new SpecificationError('Некорректная структура ZIP');
  spans.sort((a, b) => a.start - b.start);
  let next = 0;
  for (const span of spans) {
    if (span.start !== next)
      throw new SpecificationError('ZIP содержит неперечисленные или перекрывающиеся записи');
    next = span.end;
  }
  if (next !== offset) throw new SpecificationError('ZIP содержит неперечисленные записи');
}
