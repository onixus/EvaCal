import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
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
  it('preserves displayed leading-zero SKU identities without rounding numeric prices', () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['n', 'sku', 'unit', 'price'],
      ['A', 123, 'шт', 1234.56789],
      ['B', '123', 'шт', 0.000001],
    ]);
    ws.B2.z = '000000';
    ws.D2.z = '0.00';
    ws.D3.z = '0.00';
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, ws, 'Price');
    const parsed = analyzeImport(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), 'x.xlsx', {
      ...profile,
      decimalSeparator: '.',
    });
    expect(parsed.rows.map((row) => row.status)).toEqual(['ready', 'ready']);
    expect(parsed.rows.map((row) => row.normalized?.product.sku)).toEqual(['000123', '123']);
    expect(parsed.rows[0].raw[1]).toBe('000123');
    expect(parsed.rows.map((row) => row.normalized?.offer.unitPrice)).toEqual([
      '1234.56789',
      '0.000001',
    ]);
  });
  it.each([
    [0x07, '#DIV/0!'],
    [0x0f, '#VALUE!'],
    [0x17, '#REF!'],
    [0x2a, '#N/A'],
  ])('retains XLSX error %s as an error row instead of an unknown price', (code, token) => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['n', 'sku', 'unit', 'price'],
      ['A', 'A', 'шт', 1],
      ['B', 'B', 'шт', 2],
    ]);
    ws.D2 = { t: 'e', v: code };
    ws.D3 = { t: 'e', v: code, f: 'NA()' };
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, ws, 'Price');
    const parsed = analyzeImport(
      XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }),
      'x.xlsx',
      profile,
    );
    expect(parsed.rows.map((row) => row.raw[3])).toEqual([token, token]);
    expect(parsed.rows.every((row) => row.status === 'error' && row.normalized === null)).toBe(
      true,
    );
    expect(parsed.rows[0].errors.join()).toContain(`D2: ${token}`);
    expect(parsed.rows[1].errors.join()).toContain(`D3: ${token}`);
    expect(parsed.rows[0].errors.join()).toContain('явное исправление');
  });
  it('retains an unmapped error-only physical row without a formula', () => {
    const ws = XLSX.utils.aoa_to_sheet([['n', 'sku', 'unit', 'price', 'comment']]);
    ws.E3 = { t: 'e', v: 0x2a };
    ws['!ref'] = 'A1:E3';
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, ws, 'Price');
    const parsed = analyzeImport(
      XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }),
      'x.xlsx',
      profile,
    );
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({
      id: 'Price:3',
      rowNumber: 3,
      status: 'error',
      normalized: null,
    });
    expect(parsed.rows[0].raw).toEqual(['', '', '', '', '#N/A']);
    expect(parsed.rows[0].errors.join()).toContain('E3: #N/A');
  });
  async function numericPriceXml(value: string, rewrite?: (xml: string) => string) {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([
        ['n', 'sku', 'unit', 'price'],
        ['A', 'A', 'шт', 1],
      ]),
      'GPL',
    );
    const zip = await JSZip.loadAsync(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
    const path = 'xl/worksheets/sheet1.xml';
    let xml = await zip.file(path)!.async('string');
    xml = xml.replace(/(<c r="D2"[^>]*><v>)[^<]*(<\/v>)/, `$1${value}$2`);
    zip.file(path, rewrite ? rewrite(xml) : xml);
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  }
  it.each([
    ['123456789012.123456', '123456789012.123456'],
    ['999999999999.999999', '999999999999.999999'],
    ['1.23456789012123456e11', '123456789012.123456'],
    ['+123456789012123456E-6', '123456789012.123456'],
    ['1E-6', '0.000001'],
    ['1.20000E2', '120'],
  ])(
    'normalizes lexical numeric price %s without an IEEE round trip',
    async (lexical, expected) => {
      const parsed = analyzeImport(await numericPriceXml(lexical), 'x.xlsx', {
        ...profile,
        decimalSeparator: ',',
      });
      expect(parsed.rows[0].raw[3]).toBe(lexical);
      expect(parsed.rows[0].status).toBe('ready');
      expect(parsed.rows[0].normalized?.offer.unitPrice).toBe(expected);
    },
  );
  it.each(['1e12', '1e-7', '1e999999999999', '1e-999999', '123456789012.1234567'])(
    'rejects out-of-contract lexical price %s before padding or rounding',
    async (lexical) => {
      const parsed = analyzeImport(await numericPriceXml(lexical), 'x.xlsx', profile);
      expect(parsed.rows[0].raw[3]).toBe(lexical);
      expect(parsed.rows[0].status).toBe('error');
      expect(parsed.rows[0].normalized).toBeNull();
    },
  );
  it.each(['empty-value', 'duplicate-value', 'duplicate-cell'])(
    'fails closed for %s numeric price source',
    async (mode) => {
      const bytes = await numericPriceXml('1', (xml) => {
        if (mode === 'empty-value')
          return xml.replace('<c r="D2"><v>1</v></c>', '<c r="D2" t="n"><v/></c>');
        if (mode === 'duplicate-value')
          return xml.replace('<c r="D2"><v>1</v></c>', '<c r="D2"><v>1</v><v>2</v></c>');
        return xml.replace(
          '<c r="D2"><v>1</v></c>',
          '<c r="D2"><v>1</v></c><c r="D2"><v>2</v></c>',
        );
      });
      const parsed = analyzeImport(bytes, 'x.xlsx', profile);
      expect(parsed.rows[0].status).toBe('error');
      expect(parsed.rows[0].normalized).toBeNull();
    },
  );
  it('reads numeric cells with an empty type attribute without rounding', async () => {
    const bytes = await numericPriceXml('123456789012.123456', (xml) =>
      xml.replace('<c r="D2">', '<c r="D2" t="">'),
    );
    const parsed = analyzeImport(bytes, 'x.xlsx', profile);
    expect(parsed.rows[0].normalized?.offer.unitPrice).toBe('123456789012.123456');
    expect(parsed.rows[0].raw[3]).toBe('123456789012.123456');
  });
  it('retains a styled blank numeric cell as an unknown price', async () => {
    const bytes = await numericPriceXml('1', (xml) =>
      xml.replace('<c r="D2"><v>1</v></c>', '<c r="D2" s="1"/>'),
    );
    const parsed = analyzeImport(bytes, 'x.xlsx', profile);
    expect(parsed.rows[0].status).toBe('ready');
    expect(parsed.rows[0].raw[3]).toBe('');
    expect(parsed.rows[0].normalized?.offer.unitPrice).toBeNull();
  });
  it('resolves the chosen sheet relationship despite reordered sheets and an absolute target', async () => {
    const book = XLSX.utils.book_new();
    for (const [name, price] of [
      ['Other', 1],
      ['GPL', 2],
    ] as const)
      XLSX.utils.book_append_sheet(
        book,
        XLSX.utils.aoa_to_sheet([
          ['n', 'sku', 'unit', 'price'],
          ['A', 'A', 'шт', price],
        ]),
        name,
      );
    const zip = await JSZip.loadAsync(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
    const path = 'xl/worksheets/sheet2.xml';
    zip.file(
      path,
      (await zip.file(path)!.async('string')).replace('<v>2</v>', '<v>999999999999.999999</v>'),
    );
    const workbook = await zip.file('xl/workbook.xml')!.async('string');
    zip.file(
      'xl/workbook.xml',
      workbook.replace(
        /(<sheets>)(.*?)(<\/sheets>)/,
        (_all, open, value, close) =>
          open +
          value
            .match(/<sheet\b[^>]*\/>/g)
            .reverse()
            .join('') +
          close,
      ),
    );
    const relPath = 'xl/_rels/workbook.xml.rels';
    zip.file(
      relPath,
      (await zip.file(relPath)!.async('string')).replace(
        'Target="worksheets/sheet2.xml"',
        'Target="/xl/worksheets/sheet2.xml"',
      ),
    );
    const parsed = analyzeImport(
      await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
      'x.xlsx',
      { ...profile, sheet: 'GPL' },
    );
    expect(parsed.sheets[0]).toBe('GPL');
    expect(parsed.rows[0].raw[3]).toBe('999999999999.999999');
    expect(parsed.rows[0].normalized?.offer.unitPrice).toBe('999999999999.999999');
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
  it('retains physical rows and columns when the sheet begins at C5', () => {
    const sheet = XLSX.utils.aoa_to_sheet([]);
    XLSX.utils.sheet_add_aoa(
      sheet,
      [
        ['name', 'sku', 'unit', 'price'],
        ['A', 'A', 'шт', 1],
      ],
      { origin: 'C5' },
    );
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'GPL');
    const parsed = analyzeImport(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), 'x.xlsx', {
      ...profile,
      headerRow: 5,
      startRow: 6,
      mapping: { name: 2, sku: 3, unit: 4, unitPrice: 5 },
    });
    expect(parsed.headers.slice(2)).toEqual(['name', 'sku', 'unit', 'price']);
    expect(parsed.rows[0].rowNumber).toBe(6);
    expect(parsed.rows[0].raw.slice(0, 2)).toEqual(['', '']);
    expect(parsed.rows[0].normalized?.product.sku).toBe('A');
  });
  it.each(['A1:XFD10001', 'A1:D1048576'])(
    'rejects sparse oversized dimension %s before row materialization',
    async (dimension) => {
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['n']]), 'GPL');
      const zip = await JSZip.loadAsync(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
      const path = 'xl/worksheets/sheet1.xml',
        xml = await zip.file(path)!.async('string');
      zip.file(path, xml.replace(/<dimension ref="[^"]*"/, `<dimension ref="${dimension}"`));
      const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
      expect(() => analyzeImport(bytes, 'x.xlsx', profile)).toThrow(/100 колонок/);
    },
  );
});
