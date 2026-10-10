import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import type { SpecificationItem, SpecificationSnapshot } from './types';
import { decimalCell, renderSpecificationXlsx, SPEC_XLSX_HEADERS, SPEC_XLSX_SHEETS } from './xlsx';
import { prepareGost34Document } from '../gost34/generation/prepareDocument';
import { analyzeBom, parseBomProfile } from './bom-import';

const row = (id: string, patch: Partial<SpecificationItem>): SpecificationItem => ({
  id,
  kind: 'hardware',
  disposition: 'supply',
  name: id,
  vendor: 'Vendor',
  sku: `SKU-${id}`,
  quantity: '1',
  unit: 'шт.',
  configuration: '',
  licensing: 'perpetual',
  term: '',
  source: 'КП',
  rationale: 'Сайзинг',
  confirmed: true,
  unitPrice: '1',
  currency: 'RUB',
  ...patch,
});
const snapshot: SpecificationSnapshot = {
  version: 3,
  status: 'confirmed',
  emptySupplyReason: '',
  items: [
    row('Сервер', { quantity: '2', unitPrice: '1500000.5' }),
    row('Лицензия СУБД', { kind: 'license', quantity: '16', unitPrice: '0.000001' }),
    row('Поддержка', { kind: 'support', quantity: '1', unitPrice: null, currency: 'USD' }),
    row('=HYPERLINK("x")', { kind: 'other', quantity: '999999999999.999999', unitPrice: '0' }),
    row('ПО заказчика', {
      kind: 'software',
      disposition: 'existing',
      unitPrice: '0',
      changeReason: 'Используем имеющееся',
    }),
  ],
};

function readBack(buffer: Buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = (name: string) =>
    XLSX.utils.sheet_to_json<Array<string | number | null>>(wb.Sheets[name], {
      header: 1,
      defval: null,
    });
  return { wb, sheet };
}

describe('XLSX редакции спецификации', () => {
  const buffer = renderSpecificationXlsx(snapshot, {
    calculationName: 'Банк',
    customer: 'Заказчик',
  });
  const { wb, sheet } = readBack(buffer);
  const rows = sheet(SPEC_XLSX_SHEETS.items);

  it('строки совпадают со строками SPEC в том же порядке разделов', () => {
    const spec = prepareGost34Document(
      {
        calculation: { name: 'Банк', customer: 'Заказчик', specification: snapshot },
        metadataOverride: { docType: 'SPEC' },
      },
      { mode: 'preview' },
    );
    const specRows = spec.ast.sections.flatMap((s) => s.tables?.[0]?.rows ?? []);
    expect(rows[0]).toEqual([...SPEC_XLSX_HEADERS]);
    const body = rows.slice(1);
    expect(body).toHaveLength(specRows.length);
    body.forEach((cells, i) => {
      const doc = specRows[i];
      expect(cells[1]).toBe(doc[0]);
      expect(cells[2]).toBe(doc[1]);
      expect(`${cells[10]} ${cells[11]}`).toBe(doc[4]);
      expect(cells[6]).toBe(doc[5]);
      expect(cells[12] === null ? 'Цена неизвестна' : `${cells[12]} ${cells[13]}`).toBe(doc[6]);
    });
    expect(body.map((r) => r[2])).toEqual([
      'Лицензия СУБД',
      'ПО заказчика',
      'Сервер',
      'Поддержка',
      '=HYPERLINK("x")',
    ]);
  });
  it('сохраняет точность: число только при точном представлении, иначе текст; неизвестно — пусто', () => {
    const byName = new Map(rows.slice(1).map((r) => [String(r[2]), r]));
    expect(byName.get('Сервер')?.slice(10, 15)).toEqual([2, 'шт.', 1500000.5, 'RUB', 3000001]);
    expect(byName.get('Лицензия СУБД')?.[14]).toBe(0.000016);
    expect(byName.get('Поддержка')?.[12]).toBeNull();
    expect(byName.get('Поддержка')?.[14]).toBeNull();
    expect(byName.get('=HYPERLINK("x")')?.[10]).toBe('999999999999.999999');
    expect(byName.get('ПО заказчика')?.[18]).toBe('Используем имеющееся');
    expect(decimalCell('0.10')).toBe(0.1);
    expect(decimalCell('123456789012.123456')).toBe('123456789012.123456');
    expect(decimalCell(null)).toBeNull();
  });
  it('лист итогов показывает точные суммы по валютам и неполноту', () => {
    expect(sheet(SPEC_XLSX_SHEETS.totals).slice(1, 3)).toEqual([
      ['RUB', 3000001.000016, 3, 0, 'Полная'],
      ['USD', 0, 1, 1, 'Неполная сумма'],
    ]);
    const info = sheet(SPEC_XLSX_SHEETS.info);
    expect(info).toContainEqual(['Редакция', 3]);
    expect(info).toContainEqual(['Статус', 'Подтверждена']);
    expect(wb.SheetNames).toEqual(Object.values(SPEC_XLSX_SHEETS));
  });
  it('текст хранится буквально без апострофа и формул и возвращается импортом BOM', () => {
    const literal: SpecificationSnapshot = {
      ...snapshot,
      items: [
        row('-10% скидка', { quantity: '1.5', unitPrice: '1234.56789' }),
        row('+7', { kind: 'other', quantity: '2', unitPrice: null }),
        row('=SUM(A1)', { kind: 'service', quantity: '999999999999.999999', unitPrice: '0' }),
        row('@user', { kind: 'support', sku: '-SKU', quantity: null, unitPrice: '0.000001' }),
      ],
    };
    const file = renderSpecificationXlsx(literal, { calculationName: '=x', customer: '+y' });
    const ws = XLSX.read(file, { type: 'buffer', cellFormula: true }).Sheets[
      SPEC_XLSX_SHEETS.items
    ];
    for (const address of ['C2', 'C3', 'C4', 'C5']) {
      expect(ws[address].t).toBe('s');
      expect(ws[address].f).toBeUndefined();
      expect(String(ws[address].v).startsWith("'")).toBe(false);
    }
    const imported = analyzeBom(
      file,
      'SPEC.xlsx',
      parseBomProfile({ sheet: SPEC_XLSX_SHEETS.items }),
    );
    expect(imported.rows.every((r) => !r.errors.length)).toBe(true);
    const byName = new Map(imported.rows.map((r) => [r.item!.name, r.item!]));
    for (const item of literal.items) {
      const back = byName.get(item.name)!;
      expect(back).toMatchObject({
        name: item.name,
        sku: item.sku,
        kind: item.kind,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        currency: item.currency,
        unit: item.unit,
      });
    }
  });
});
