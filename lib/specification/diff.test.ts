import { describe, expect, it } from 'vitest';
import type { SpecificationItem, SpecificationSnapshot } from './types';
import { diffSpecifications } from './diff';
import { parseSpecification } from './validation';

const row = (id: string, patch: Partial<SpecificationItem> = {}): SpecificationItem => ({
  id,
  kind: 'hardware',
  disposition: 'supply',
  name: `Позиция ${id}`,
  vendor: 'V',
  sku: id.toUpperCase(),
  quantity: '1',
  unit: 'шт.',
  configuration: '',
  licensing: '',
  term: '',
  source: 's',
  rationale: 'r',
  confirmed: true,
  unitPrice: '10',
  currency: 'RUB',
  ...patch,
});
const snap = (
  version: number,
  items: SpecificationItem[],
  status: SpecificationSnapshot['status'] = 'draft',
): SpecificationSnapshot => ({ version, status, emptySupplyReason: '', items });

describe('Сравнение редакций спецификации', () => {
  it('находит добавленные, удаленные и измененные поля, количество, цену и итоги', () => {
    const before = snap(
      1,
      [row('a'), row('b'), row('c', { currency: 'USD', unitPrice: '5' })],
      'confirmed',
    );
    const after = snap(2, [
      row('a', { quantity: '3', unitPrice: '12.5', changeReason: 'Сайзинг v2' }),
      row('c', { currency: 'USD', unitPrice: '5' }),
      row('d', { name: 'Новая', unitPrice: null }),
    ]);
    const diff = diffSpecifications(before, after);
    expect(diff.from).toBe(1);
    expect(diff.to).toBe(2);
    expect(diff.status).toEqual({ before: 'confirmed', after: 'draft' });
    expect(diff.added.map((i) => [i.id, i.amount])).toEqual([['d', null]]);
    expect(diff.removed.map((i) => [i.id, i.amount])).toEqual([['b', '10']]);
    expect(diff.unchangedCount).toBe(1);
    expect(diff.changed).toEqual([
      {
        id: 'a',
        name: 'Позиция a',
        changes: [
          { field: 'quantity', before: '1', after: '3' },
          { field: 'unitPrice', before: '10', after: '12.5' },
        ],
        amount: { before: '10', after: '37.5' },
        changeReason: 'Сайзинг v2',
        moved: false,
      },
    ]);
    expect(diff.totals).toEqual([
      {
        currency: 'RUB',
        before: expect.objectContaining({ total: '20', incomplete: false }),
        after: expect.objectContaining({ total: '37.5', incomplete: true }),
        delta: '17.5',
        incomplete: true,
      },
      {
        currency: 'USD',
        before: expect.objectContaining({ total: '5' }),
        after: expect.objectContaining({ total: '5' }),
        delta: '0',
        incomplete: false,
      },
    ]);
  });
  it('сравнивает десятичные точно: 1.50 = 1.5, неизвестно ≠ 0', () => {
    const diff = diffSpecifications(
      snap(1, [row('a', { quantity: '1.50' }), row('b', { unitPrice: '0' })]),
      snap(2, [row('a', { quantity: '1.5' }), row('b', { unitPrice: null })]),
    );
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].changes).toEqual([{ field: 'unitPrice', before: '0', after: null }]);
    expect(diff.totals[0].incomplete).toBe(true);
  });
  it('учитывает смену валюты, назначения и подтверждения, отмечает перестановку', () => {
    const diff = diffSpecifications(
      snap(1, [row('a'), row('b')]),
      snap(2, [row('b'), row('a', { currency: 'EUR', disposition: 'existing', confirmed: false })]),
    );
    const a = diff.changed.find((c) => c.id === 'a')!;
    expect(a.changes.map((c) => c.field)).toEqual(['disposition', 'currency', 'confirmed']);
    expect(a.moved).toBe(false);
    expect(diff.changed.filter((c) => c.moved).map((c) => c.id)).toEqual(['b']);
    expect(diff.totals.map((t) => [t.currency, t.delta])).toEqual([['RUB', '-10']]);
  });
  it('причина изменения необязательна: старые снимки читаются, пустая причина не сохраняется', () => {
    const legacy = parseSpecification(JSON.parse(JSON.stringify(snap(1, [row('a')]))));
    expect(legacy.items[0]).not.toHaveProperty('changeReason');
    const blank = parseSpecification(snap(1, [row('a', { changeReason: '  ' })]));
    expect(blank.items[0]).not.toHaveProperty('changeReason');
    const noted = parseSpecification(snap(1, [row('a', { changeReason: ' Замена ' })]));
    expect(noted.items[0].changeReason).toBe('Замена');
    expect(() =>
      parseSpecification(snap(1, [row('a', { changeReason: 'x'.repeat(1001) })])),
    ).toThrow(/Причина изменения/);
  });
  it('«порядок изменен» только у фактически перемещенных строк', () => {
    const items = ['a', 'b', 'c', 'd', 'e'].map((id) => row(id));
    const reorder = (ids: string[]) => ids.map((id) => items.find((i) => i.id === id)!);
    const moved = (ids: string[]) =>
      diffSpecifications(snap(1, items), snap(2, reorder(ids)))
        .changed.filter((c) => c.moved)
        .map((c) => c.id);
    // Moving one row to the end shifts others, but only that row is reported.
    expect(moved(['b', 'c', 'd', 'e', 'a'])).toEqual(['a']);
    expect(moved(['e', 'a', 'b', 'c', 'd'])).toEqual(['e']);
    expect(moved(['a', 'b', 'c', 'd', 'e'])).toEqual([]);
    // Swapping neighbours: one of the pair is moved.
    expect(moved(['a', 'c', 'b', 'd', 'e'])).toHaveLength(1);
    // Removal or insertion alone does not mark surviving rows as moved.
    const diff = diffSpecifications(
      snap(1, items),
      snap(2, [row('x'), ...reorder(['a', 'c', 'd', 'e'])]),
    );
    expect(diff.changed).toEqual([]);
    expect(diff.unchangedCount).toBe(4);
  });
});
