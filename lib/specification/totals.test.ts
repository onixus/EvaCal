import { describe, expect, it } from 'vitest';
import type { SpecificationItem } from './types';
import {
  describeTotal,
  lineAmount,
  normalizeDecimal,
  roundDecimal,
  subtractDecimal,
  summarizeSpecification,
} from './totals';
import { summarizeSpecification as legacySummarize } from './gpl-update-selection';

const row = (id: string, patch: Partial<SpecificationItem> = {}): SpecificationItem => ({
  id,
  kind: 'hardware',
  disposition: 'supply',
  name: id,
  vendor: '',
  sku: '',
  quantity: '1',
  unit: 'шт.',
  configuration: '',
  licensing: '',
  term: '',
  source: 's',
  rationale: 'r',
  confirmed: true,
  unitPrice: '1',
  currency: 'RUB',
  ...patch,
});

describe('Точные итоги спецификации', () => {
  it('неизвестная цена или количество делает итог неполным, а не нулевым', () => {
    const totals = summarizeSpecification({
      items: [
        row('a', { quantity: '2', unitPrice: '10' }),
        row('b', { unitPrice: null }),
        row('c', { quantity: null }),
      ],
    });
    expect(totals).toEqual([
      { currency: 'RUB', total: '20', unknownCount: 2, includedCount: 3, incomplete: true },
    ]);
    expect(describeTotal(totals[0])).toContain('неполная сумма');
  });
  it('бесплатная позиция с ценой 0 оставляет итог полным', () => {
    expect(
      summarizeSpecification({ items: [row('free', { quantity: '5', unitPrice: '0' })] }),
    ).toEqual([
      { currency: 'RUB', total: '0', unknownCount: 0, includedCount: 1, incomplete: false },
    ]);
  });
  it('считает отдельно по валютам без конвертации и не включает имеющееся и альтернативы', () => {
    const totals = summarizeSpecification({
      items: [
        row('rub', { quantity: '3', unitPrice: '100.5' }),
        row('usd', { currency: 'USD', quantity: '2', unitPrice: '0.25' }),
        row('eur', { currency: 'EUR', unitPrice: null }),
        row('existing', { disposition: 'existing', unitPrice: '1000000' }),
        row('alt', { disposition: 'alternative', unitPrice: '1000000' }),
        row('nocurrency', { currency: '', unitPrice: '7' }),
      ],
    });
    expect(totals.map((t) => [t.currency, t.total, t.incomplete])).toEqual([
      ['', '0', true],
      ['EUR', '0', true],
      ['RUB', '301.5', false],
      ['USD', '0.5', false],
    ]);
  });
  it('сохраняет 6 знаков количества и цены и 12 знаков суммы без плавающей точки', () => {
    const a = row('a', { quantity: '0.000001', unitPrice: '0.000001' });
    const b = row('b', { quantity: '999999999999.999999', unitPrice: '0.000001' });
    const c = row('c', { quantity: '0.1', unitPrice: '0.2' });
    expect(lineAmount(a)).toBe('0.000000000001');
    expect(lineAmount(c)).toBe('0.02');
    expect(lineAmount(b)).toBe('999999.999999999999');
    expect(summarizeSpecification({ items: [a, b, c] })[0].total).toBe('1000000.02');
  });
  it('округляет только при показе: до 0,01 по правилу половины вверх', () => {
    expect(roundDecimal('2.675')).toBe('2.68');
    expect(roundDecimal('2.674999999999')).toBe('2.67');
    expect(roundDecimal('0.005')).toBe('0.01');
    expect(roundDecimal('0.004999')).toBe('0.00');
    expect(roundDecimal('-1.005')).toBe('-1.01');
    expect(roundDecimal('10')).toBe('10.00');
    expect(roundDecimal('999999999999999998000000.000000000001')).toBe(
      '999999999999999998000000.00',
    );
    const total = summarizeSpecification({
      items: [row('a', { quantity: '3', unitPrice: '0.333333' })],
    })[0];
    expect(total.total).toBe('0.999999');
    expect(describeTotal(total)).toBe('1.00 (точно: 0.999999) RUB — 1 поз.');
  });
  it('нормализует и вычитает десятичные строки точно', () => {
    expect(normalizeDecimal('1.500000')).toBe('1.5');
    expect(subtractDecimal('1', '1.000001')).toBe('-0.000001');
    expect(subtractDecimal('0.3', '0.1')).toBe('0.2');
  });
  it('старый импорт из gpl-update-selection указывает на ту же функцию', () => {
    expect(legacySummarize).toBe(summarizeSpecification);
  });
});
