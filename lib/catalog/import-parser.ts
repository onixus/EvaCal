import * as XLSX from 'xlsx';
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
      cellHTML: false,
      cellStyles: false,
    });
    sheets = workbook.SheetNames;
    const chosen = profile.sheet || sheets[0];
    if (!sheets.includes(chosen)) throw new SpecificationError('Лист не найден');
    const ws = workbook.Sheets[chosen];
    for (const [address, cell] of Object.entries(ws))
      if (!address.startsWith('!') && cell.f) formulas.add(XLSX.utils.decode_cell(address).r);
    cells = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      raw: true,
      defval: '',
      blankrows: true,
    }) as string[][];
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
    if (!raw.some((c) => c.trim())) continue;
    const get = (f: (typeof IMPORT_FIELDS)[number]) =>
      profile.mapping[f] === undefined ? '' : (raw[profile.mapping[f]!] ?? '').trim();
    const errors: string[] = [];
    let normalized: ImportRow['normalized'] = null;
    try {
      if (formulas.has(i))
        throw new SpecificationError(
          'Строка содержит формулу: требуется явное исправление значений',
        );
      const priceRaw = get('unitPrice');
      const price = priceRaw
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
