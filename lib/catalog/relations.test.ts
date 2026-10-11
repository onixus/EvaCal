import { describe, expect, it } from 'vitest';
import {
  alternativesOf,
  checkRelation,
  componentQuantity,
  componentsOf,
  createsCycle,
  expandBundle,
  relationInput,
  replacementsOf,
  type ProductRelation,
} from './relations';
import { parseSpecification } from '../specification/validation';
import { summarizeSpecification } from '../specification/totals';
import type { SpecificationItem } from '../specification/types';

const edge = (fromProductId: string, toProductId: string, type: ProductRelation['type']) => ({
  fromProductId,
  toProductId,
  type,
});
const relation = (
  id: string,
  from: string,
  to: string,
  type: ProductRelation['type'],
  patch: Partial<ProductRelation> = {},
): ProductRelation => ({
  id,
  ...edge(from, to, type),
  quantity: type === 'bundleComponent' ? '2' : null,
  note: '',
  createdBy: 'u',
  createdAt: '2026-10-10',
  archivedAt: null,
  archivedBy: null,
  ...patch,
});
const item = (id: string, patch: Partial<SpecificationItem> = {}): SpecificationItem => ({
  id,
  kind: 'hardware',
  disposition: 'supply',
  name: id,
  vendor: 'V',
  sku: id,
  quantity: '1',
  unit: 'шт.',
  configuration: '',
  licensing: '',
  term: '',
  source: 'Каталог',
  rationale: '',
  confirmed: false,
  unitPrice: '100',
  currency: 'RUB',
  ...patch,
});

describe('Связи каталога: проверка ввода', () => {
  it('самосвязь запрещена', () => {
    expect(() => relationInput({ type: 'replaces', fromProductId: 'a', toProductId: 'a' })).toThrow(
      /саму себя/,
    );
  });
  it('количество обязательно и положительно только для компонента комплекта', () => {
    expect(
      relationInput({
        type: 'bundleComponent',
        fromProductId: 'b',
        toProductId: 'c',
        quantity: '2.5',
      }).quantity,
    ).toBe('2.5');
    for (const quantity of ['0', '0.000', '-1', '1e3', 2, null])
      expect(() =>
        relationInput({ type: 'bundleComponent', fromProductId: 'b', toProductId: 'c', quantity }),
      ).toThrow();
    expect(() =>
      relationInput({ type: 'replaces', fromProductId: 'a', toProductId: 'b', quantity: '1' }),
    ).toThrow(/только для компонента/);
    expect(relationInput({ type: 'alternative', fromProductId: 'a', toProductId: 'b' })).toEqual({
      type: 'alternative',
      fromProductId: 'a',
      toProductId: 'b',
      quantity: null,
      note: '',
    });
  });
  it('неизвестный тип связи отклоняется', () => {
    expect(() => relationInput({ type: 'parent', fromProductId: 'a', toProductId: 'b' })).toThrow();
  });
});

describe('Связи каталога: циклы и дубли', () => {
  it('цепочка замен допустима, цикл замен — нет', () => {
    const active = [edge('b', 'a', 'replaces'), edge('c', 'b', 'replaces')];
    expect(createsCycle(active, edge('d', 'c', 'replaces'))).toBe(false);
    expect(createsCycle(active, edge('a', 'c', 'replaces'))).toBe(true);
    expect(() => checkRelation(active, edge('a', 'c', 'replaces'))).toThrow(/Цикл замен/);
    expect(createsCycle(active, edge('a', 'b', 'replaces'))).toBe(true);
  });
  it('цикл состава комплектов отклоняется; связи других типов не образуют цикл', () => {
    const active = [edge('k1', 'k2', 'bundleComponent'), edge('a', 'k1', 'replaces')];
    expect(() => checkRelation(active, edge('k2', 'k1', 'bundleComponent'))).toThrow(
      /Цикл состава/,
    );
    expect(createsCycle(active, edge('k1', 'a', 'replaces'))).toBe(true);
    expect(createsCycle(active, edge('k1', 'a', 'bundleComponent'))).toBe(false);
  });
  it('дубль и обратная альтернатива отклоняются (409)', () => {
    const active = [edge('a', 'b', 'alternative')];
    expect(() => checkRelation(active, edge('a', 'b', 'alternative'))).toThrow(/уже существует/);
    expect(() => checkRelation(active, edge('b', 'a', 'alternative'))).toThrow(/обратном/);
    expect(() => checkRelation(active, edge('b', 'a', 'replaces'))).not.toThrow();
  });
  it('архивные связи не участвуют в выборке', () => {
    const relations = [
      relation('r1', 'new', 'old', 'replaces'),
      relation('r2', 'newer', 'old', 'replaces', { archivedAt: '2026-10-11', archivedBy: 'u' }),
      relation('r3', 'x', 'old', 'alternative'),
      relation('r4', 'old', 'y', 'alternative'),
      relation('r5', 'kit', 'old', 'bundleComponent'),
    ];
    expect(replacementsOf(relations, 'old').map((r) => r.id)).toEqual(['r1']);
    expect(alternativesOf(relations, 'old').map((a) => a.productId)).toEqual(['x', 'y']);
    expect(componentsOf(relations, 'kit').map((r) => r.toProductId)).toEqual(['old']);
  });
});

describe('Комплекты: количества и итоги без двойного счета', () => {
  it('количество компонента = комплекты × количество на комплект, точно', () => {
    expect(componentQuantity('3', '2')).toBe('6');
    expect(componentQuantity('1.5', '0.5')).toBe('0.75');
    expect(() => componentQuantity('1.5', '0.333333')).toThrow(/точность/);
    expect(componentQuantity(null, '2')).toBeNull();
    expect(() => componentQuantity('0.1234567', '1')).toThrow();
  });
  it('раскрытие комплекта ссылается на строку комплекта и не удваивает итог', () => {
    const bundle = item('kit', { kind: 'bundle', quantity: '2', unitPrice: '1000' });
    const rows = expandBundle(bundle, [
      { item: item('server', { unitPrice: '700' }), perBundle: '1' },
      { item: item('os', { kind: 'license', unitPrice: '150', licensing: 'OEM' }), perBundle: '2' },
    ]);
    expect(rows.map((r) => [r.id, r.quantity, r.includedIn])).toEqual([
      ['kit', '2', undefined],
      ['server', '2', 'kit'],
      ['os', '4', 'kit'],
    ]);
    const snapshot = parseSpecification({
      version: 0,
      status: 'draft',
      emptySupplyReason: '',
      items: rows,
    });
    expect(summarizeSpecification(snapshot)).toEqual([
      { currency: 'RUB', total: '2000', unknownCount: 0, includedCount: 1, incomplete: false },
    ]);
  });
  it('раскрывается только позиция-комплект', () => {
    expect(() => expandBundle(item('x'), [])).toThrow(/комплекта/);
  });
});
