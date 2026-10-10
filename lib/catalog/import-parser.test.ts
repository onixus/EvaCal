import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { analyzeImport, importProfile } from './import-parser';
const profile = importProfile({
  vendorId: 'v',
  mapping: { name: 0, sku: 1, unit: 2, unitPrice: 3 },
  delimiter: ';',
  decimalSeparator: ',',
});
const csv = (content: string) => analyzeImport(Buffer.from(content), 'GPL.csv', profile);
describe('GPL source analysis', () => {
  it('preserves quoted raw rows, decimal precision and unknown versus zero', () => {
    const parsed = csv('Название;SKU;Ед;Цена\n"A; quoted";A;шт;1 234,000001\nB;B;шт;\nC;C;шт;0');
    expect(parsed.rows.map((r) => r.normalized?.offer.unitPrice)).toEqual([
      '1234.000001',
      null,
      '0',
    ]);
    expect(parsed.rows[0].raw[0]).toBe('A; quoted');
    expect(parsed.rows[0].rowNumber).toBe(2);
  });
  it('flags duplicates, malformed and excessive decimal input', () => {
    const rows = csv('n;s;u;p\nA;A;шт;1,0000001\nB;B;шт;1\nC;B;шт;2\nD;D;шт;-1').rows;
    expect(rows.map((r) => r.status)).toEqual(['error', 'ready', 'error', 'error']);
    expect(() => csv('n;s;u;p\n"missing')).toThrow(/кавычки/);
    expect(() => csv('n;s;u;p\n"A"suffix;SKU;шт;1')).toThrow(/закрывающих/);
    expect(() => csv('n;s;u;p\n"""suffix;SKU;шт;1')).toThrow(/кавычки/);
  });
  it('permits same SKU in different editions', () => {
    const p = { ...profile, mapping: { ...profile.mapping, edition: 4 } };
    expect(
      analyzeImport(Buffer.from('n;s;u;p;e\nA;X;шт;1;A\nA;X;шт;1;B'), 'x.csv', p).rows.every(
        (r) => r.status === 'ready',
      ),
    ).toBe(true);
  });
  it('uses typed source values instead of rounded display and rejects formulas', () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['n', 'sku', 'unit', 'price'],
      ['A', 'A', 'шт', 1234.56789],
      ['B', 'B', 'шт', 2],
    ]);
    ws.D2.z = '0.00';
    ws.D3.f = '1+1';
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, ws, 'Price');
    const result = analyzeImport(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), 'x.xlsx', {
      ...profile,
      decimalSeparator: '.',
    });
    expect(result.rows[0].normalized?.offer.unitPrice).toBe('1234.56789');
    expect(result.rows[1].status).toBe('error');
    expect(result.rows[1].errors.join()).toMatch(/формул/);
  });
  it('selects sheet, header and range without deriving catalog values', () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['unused']]), 'Other');
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([
        ['title'],
        ['n', 'sku', 'unit', 'price'],
        ['A', 'A', 'шт', 1],
        ['B', 'B', 'шт', 2],
      ]),
      'GPL',
    );
    const result = analyzeImport(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), 'x.xlsx', {
      ...profile,
      sheet: 'GPL',
      headerRow: 2,
      startRow: 4,
      endRow: 4,
    });
    expect(result.sheets).toEqual(['Other', 'GPL']);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].rowNumber).toBe(4);
  });
  it('rejects oversized archive directory before decompression', () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['n']]), 'GPL');
    const bytes = Buffer.from(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
    for (let i = 0; i < bytes.length - 46; i++)
      if (bytes.readUInt32LE(i) === 0x02014b50) {
        bytes.writeUInt32LE(40 * 1024 * 1024, i + 24);
        break;
      }
    expect(() => analyzeImport(bytes, 'x.xlsx', profile)).toThrow(/размер/);
  });
  it.each(['compressed', 'uncompressed'])(
    'rejects forged %s ZIP sizes despite consistent local metadata',
    (mode) => {
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        book,
        XLSX.utils.aoa_to_sheet([['n'], ['long value repeated long value repeated']]),
        'GPL',
      );
      const bytes = Buffer.from(
        XLSX.write(book, { type: 'buffer', bookType: 'xlsx', compression: true }),
      );
      const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 1, 2])),
        local = bytes.readUInt32LE(central + 42);
      bytes.writeUInt32LE(1, central + (mode === 'compressed' ? 20 : 24));
      bytes.writeUInt32LE(1, local + (mode === 'compressed' ? 18 : 22));
      expect(() => analyzeImport(bytes, 'x.xlsx', profile)).toThrow(/распакованный/);
    },
  );
  it('rejects unlisted prefix bytes before local records', () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['n']]), 'GPL');
    const original = Buffer.from(
      XLSX.write(book, { type: 'buffer', bookType: 'xlsx', compression: true }),
    );
    const bytes = Buffer.concat([Buffer.from([0]), original]);
    for (let i = 1; i < bytes.length - 46; i++)
      if (bytes.readUInt32LE(i) === 0x02014b50)
        bytes.writeUInt32LE(bytes.readUInt32LE(i + 42) + 1, i + 42);
    const end = bytes.length - 22;
    bytes.writeUInt32LE(bytes.readUInt32LE(end + 16) + 1, end + 16);
    expect(() => analyzeImport(bytes, 'x.xlsx', profile)).toThrow(/неперечисленные/);
  });
  it('rejects text or a quote after closing CSV quotes', () => {
    expect(() => csv('n;s;u;p\n"A"suffix;SKU;шт;1')).toThrow(/закрывающих/);
    expect(() => csv('n;s;u;p\n"" "suffix;SKU;шт;1')).toThrow(/закрывающих/);
  });
});
