import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseImportTaxRate, parseTaxInput, taxLabel, technicalDiff } from './import-values';
import { analyzeImport, importProfile, percentFormat } from './import-parser';
import { businessDate } from './business-date';
import { offerInput } from './validation';

describe('shared tax parsing', () => {
  it.each([
    ['Без НДС', { taxRate: '0', taxExempt: true }],
    ['без  ндс', { taxRate: '0', taxExempt: true }],
    ['НДС не облагается', { taxRate: '0', taxExempt: true }],
    ['0', { taxRate: '0', taxExempt: false }],
    ['20', { taxRate: '20', taxExempt: false }],
    ['0,5%', { taxRate: '0.5', taxExempt: false }],
    ['1%', { taxRate: '1', taxExempt: false }],
    ['', { taxRate: null, taxExempt: false }],
  ])('parses %s', (value, expected) => {
    expect(parseImportTaxRate(value, ',')).toEqual(expected);
  });
  it.each(['0,2', '1', '0.5'])('rejects ambiguous bare fraction %s', (value) => {
    expect(() => parseImportTaxRate(value, value.includes(',') ? ',' : '.')).toThrow(
      /неоднозначно/,
    );
  });
  it('manual forms accept either decimal separator and the exemption', () => {
    expect(parseTaxInput('10,5')).toEqual({ taxRate: '10.5', taxExempt: false });
    expect(parseTaxInput('10.5 %')).toEqual({ taxRate: '10.5', taxExempt: false });
    expect(parseTaxInput('Без НДС')).toEqual({ taxRate: '0', taxExempt: true });
    expect(parseTaxInput(null)).toEqual({ taxRate: null, taxExempt: false });
    expect(taxLabel({ taxRate: '0', taxExempt: true })).toBe('Без НДС');
    expect(taxLabel({ taxRate: null })).toBe('НДС неизвестен');
  });
  it('validates the exemption flag on offers', () => {
    const base = { source: 's', unitPrice: null, currency: 'RUB', region: '', terms: '' };
    expect(
      offerInput({ ...base, priceDate: null, validUntil: null, taxRate: '0', taxExempt: true })
        .taxExempt,
    ).toBe(true);
    expect(() =>
      offerInput({ ...base, priceDate: null, validUntil: null, taxRate: '20', taxExempt: true }),
    ).toThrow(/Без НДС/);
    expect(offerInput({ ...base, priceDate: null, validUntil: null }).taxExempt).toBe(false);
  });
  it.each([
    ['0%', 'scaled'],
    ['0.00%', 'scaled'],
    ['0"%"', 'literal'],
    ['0\\%', 'literal'],
    ['General', null],
    ['[Red]0.00', null],
  ])('classifies number format %s', (format, kind) => {
    expect(percentFormat(format)).toBe(kind);
  });
  it('reads XLSX tax cells by format: real percent, literal percent, ambiguous General', () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['n', 'sku', 'unit', 'vat'],
      ['A', 'A', 'шт', 0.2],
      ['B', 'B', 'шт', 20],
      ['C', 'C', 'шт', 0.2],
      ['D', 'D', 'шт', 'Без НДС'],
      ['E', 'E', 'шт', 0.005],
    ]);
    ws.D2.z = '0%';
    ws.D3.z = '0"%"';
    ws.D6.z = '0.0%';
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, ws, 'GPL');
    const rows = analyzeImport(
      XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }),
      'x.xlsx',
      importProfile({ vendorId: 'v', mapping: { name: 0, sku: 1, unit: 2, taxRate: 3 } }),
    ).rows;
    expect(rows.map((r) => r.normalized?.offer.taxRate ?? null)).toEqual([
      '20',
      '20',
      null,
      '0',
      '0.5',
    ]);
    expect(rows[2].errors.join()).toMatch(/НДС: «0.2» — неоднозначно/);
    expect(rows[3].normalized?.offer.taxExempt).toBe(true);
  });
});

describe('technical identity diff', () => {
  const base = {
    vendorId: 'v',
    name: 'A',
    sku: 'A',
    edition: '',
    kind: 'hardware' as const,
    unit: 'шт',
    licensing: '',
    attributes: [],
  };
  it('reports newly mapped attributes and kind, ignoring attribute order', () => {
    expect(
      technicalDiff(base, {
        ...base,
        kind: 'software',
        attributes: [{ name: 'Производитель', value: 'X', unit: '' }],
      }),
    ).toEqual([
      { field: 'kind', before: 'hardware', after: 'software' },
      { field: 'attributes', before: '', after: 'Производитель: X' },
    ]);
    const two = [
      { name: 'A', value: '1', unit: '' },
      { name: 'B', value: '2', unit: 'ГБ' },
    ];
    expect(
      technicalDiff({ ...base, attributes: two }, { ...base, attributes: [...two].reverse() }),
    ).toEqual([]);
  });
});

describe('business date', () => {
  it('uses the business time zone instead of the UTC calendar date', () => {
    expect(businessDate('2026-10-09T22:30:00Z', 'Europe/Moscow')).toBe('2026-10-10');
    expect(businessDate('2026-10-09T20:30:00Z', 'Europe/Moscow')).toBe('2026-10-09');
    expect(businessDate('2026-10-09T22:30:00Z', 'Invalid/Zone')).toBe('2026-10-10');
    expect(businessDate('nonsense')).toBeNull();
  });
});
