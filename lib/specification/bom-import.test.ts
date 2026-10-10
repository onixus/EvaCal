import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  analyzeBom,
  exactDecimal,
  guessBomMapping,
  mergeBomRows,
  parseBomProfile,
} from './bom-import';
import type { SpecificationSnapshot } from './types';

const csv = (content: string, profile: Record<string, unknown> = {}) =>
  analyzeBom(
    Buffer.from(content),
    'BOM.csv',
    parseBomProfile({ delimiter: ';', decimalSeparator: ',', ...profile }),
  );

describe('Импорт BOM в черновик спецификации', () => {
  it('автоматически сопоставляет колонки и показывает ошибки строк до сохранения', () => {
    const preview = csv(
      [
        'Наименование;Артикул;Производитель;Кол-во;Ед. изм.;Цена;Валюта;Тип',
        'Сервер;SRV-1;Vendor;2;шт;1 234,5;RUB;оборудование',
        'Лицензия;LIC-1;Vendor;16;шт;;USD;license',
        ';NONAME;Vendor;1;шт;1;RUB;',
        'Диск;D-1;Vendor;-1;шт;1;RUB;',
        'Кабель;C-1;Vendor;1;шт;1,0000001;RUB;',
        'Стойка;R-1;Vendor;1;шт;1;руб;',
        'Модуль;M-1;Vendor;1;шт;1;RUB;непонятно',
        'Сервер;SRV-1;Vendor;1;шт;0;RUB;',
      ].join('\n'),
    );
    expect(preview.profile.mapping).toMatchObject({
      name: 0,
      sku: 1,
      vendor: 2,
      quantity: 3,
      unit: 4,
      unitPrice: 5,
      currency: 6,
      kind: 7,
    });
    expect(preview.rows.map((r) => [r.rowNumber, r.errors.length > 0])).toEqual([
      [2, false],
      [3, false],
      [4, true],
      [5, true],
      [6, true],
      [7, true],
      [8, true],
      [9, false],
    ]);
    const [server, license] = preview.rows.map((r) => r.item);
    expect(server).toMatchObject({
      name: 'Сервер',
      sku: 'SRV-1',
      vendor: 'Vendor',
      kind: 'hardware',
      quantity: '2',
      unitPrice: '1234.5',
      currency: 'RUB',
      disposition: 'supply',
      confirmed: false,
      source: 'BOM.csv · CSV · строка 2',
    });
    expect(license).toMatchObject({ kind: 'license', unitPrice: null, currency: 'USD' });
    expect(preview.rows[2].errors.join()).toMatch(/Наименование/);
    expect(preview.rows[3].errors.join()).toMatch(/неотрицательное/);
    expect(preview.rows[4].errors.join()).toMatch(/6 дробных/);
    expect(preview.rows[5].errors.join()).toMatch(/Валюта/);
    expect(preview.rows[6].errors.join()).toMatch(/тип/);
    // Repeated SKU is legitimate in a BOM (unlike GPL identity rules); price 0 stays free.
    expect(preview.rows[7].item?.unitPrice).toBe('0');
  });
  it('без колонки наименования каждая строка требует сопоставления', () => {
    const preview = csv('a;b\nx;1', { mapping: { quantity: 1 } });
    expect(preview.rows[0].errors).toEqual(['Сопоставьте колонку наименования']);
  });
  it('XLSX: точные количество и цена из исходных чисел, формулы отклоняются', () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Name', 'Qty', 'Price'],
      ['A', 1.5, 1234.56789],
      ['B', 3, 2],
      ['C', 0.000001, 999999999999.5],
    ]);
    ws.B2.z = '0';
    ws.C2.z = '0.00';
    ws.C3.f = '1+1';
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, ws, 'BOM');
    const preview = analyzeBom(
      XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }),
      'bom.xlsx',
      parseBomProfile({}),
    );
    expect(preview.sheets).toEqual(['BOM']);
    expect(preview.rows[0].item).toMatchObject({ quantity: '1.5', unitPrice: '1234.56789' });
    expect(preview.rows[1].errors.join()).toMatch(/формул/);
    expect(preview.rows[2].item).toMatchObject({
      quantity: '0.000001',
      unitPrice: '999999999999.5',
    });
  });
  it('точное преобразование десятичных значений', () => {
    expect(exactDecimal('1.5E-3', '.')).toBe('0.0015');
    expect(exactDecimal('12E2', '.')).toBe('1200');
    expect(exactDecimal('0,000001', ',')).toBe('0.000001');
    expect(exactDecimal(' ', '.')).toBeNull();
    expect(() => exactDecimal('1E13', '.')).toThrow(/12 целых/);
    expect(() => exactDecimal('abc', '.')).toThrow(/десятичное/);
  });
  it('сопоставление заголовков не назначает одну колонку дважды', () => {
    expect(guessBomMapping(['Описание', 'Наименование', 'Цена за ед.', 'Валюта'])).toEqual({
      configuration: 0,
      name: 1,
      unitPrice: 2,
      currency: 3,
    });
  });
  it('в черновик попадают только выбранные допустимые строки', () => {
    const preview = csv('Наименование;Кол-во\nA;1\n;2\nB;3');
    const current: SpecificationSnapshot = {
      version: 4,
      status: 'released',
      emptySupplyReason: '',
      items: [],
    };
    const ok = preview.rows.filter((r) => !r.errors.length).map((r) => r.id);
    const next = mergeBomRows(current, preview, ok);
    expect(next.status).toBe('draft');
    expect(next.version).toBe(4);
    expect(next.items.map((i) => i.name)).toEqual(['A', 'B']);
    expect(() => mergeBomRows(current, preview, [preview.rows[1].id])).toThrow(/ошибки/);
    expect(() => mergeBomRows(current, preview, ['unknown'])).toThrow(/отсутствует/);
    expect(() => mergeBomRows(current, preview, [])).toThrow(/Выберите/);
  });
  it('проверяет профиль импорта', () => {
    expect(() => parseBomProfile({ mapping: { price: 1 } })).toThrow(/Неизвестное поле/);
    expect(() => parseBomProfile({ mapping: { name: 100 } })).toThrow(/0–99/);
    expect(() => parseBomProfile({ headerRow: 3, startRow: 2 })).toThrow(/после заголовка/);
    expect(() => parseBomProfile({ currency: 'rub' })).toThrow(/Валюта/);
  });
});
