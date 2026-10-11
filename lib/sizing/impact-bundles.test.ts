import { describe, expect, it } from 'vitest';
import { applySizingSelections, buildSizingImpact, type SizingImpactRun } from './impact';
import type { SpecificationItem, SpecificationSnapshot } from '../specification/types';

const row = (over: Partial<SpecificationItem>): SpecificationItem => ({
  id: 'i',
  kind: 'hardware',
  disposition: 'supply',
  name: 'Узел',
  vendor: 'V',
  sku: 'SKU',
  quantity: '2',
  unit: 'шт.',
  configuration: '',
  licensing: '',
  term: '',
  source: 'КП',
  rationale: 'сайзинг',
  confirmed: true,
  unitPrice: '100',
  currency: 'RUB',
  ...over,
});
const run: SizingImpactRun = {
  id: 'run-2',
  source: 'profile',
  label: 'v2',
  outputs: {
    base: [
      {
        key: 'nodes',
        label: 'nodes',
        kind: 'nodes',
        unit: 'шт.',
        value: 4,
        missing: [],
        assumptions: [],
        basis: '',
      },
    ],
  },
};

describe('sizing impact and bundles (totals rule 3a)', () => {
  it('a bundle component keeps quantity coverage but has no cost of its own', () => {
    const snapshot: SpecificationSnapshot = {
      version: 1,
      status: 'draft',
      emptySupplyReason: '',
      items: [
        row({ id: 'kit', kind: 'bundle', quantity: '1', unitPrice: '1000' }),
        row({
          id: 'node',
          includedIn: 'kit',
          sizingRef: { runId: 'run-1', metric: 'nodes', requiredQuantity: '2' },
        }),
      ],
    };
    const preview = buildSizingImpact(snapshot, run);
    const component = preview.rows.find((r) => r.itemId === 'node')!;
    expect(component).toMatchObject({
      status: 'deficit',
      proposedQuantity: '4',
      amountBefore: null,
      amountAfter: null,
      amountDelta: null,
    });
    // The bundle row carries the price; changing the component quantity does not change totals.
    expect(preview.totals.before[0].total).toBe('1000');
    expect(preview.totals.after[0].total).toBe('1000');
  });
  it('is never pre-selected; proposes the bundle quantity and blocks direct apply', () => {
    const snapshot: SpecificationSnapshot = {
      version: 1,
      status: 'draft',
      emptySupplyReason: '',
      items: [
        row({ id: 'kit', kind: 'bundle', quantity: '1', unitPrice: '1000' }),
        // 2 nodes per bundle; 4 nodes needed → 2 bundles.
        row({
          id: 'node',
          includedIn: 'kit',
          sizingRef: { runId: 'run-1', metric: 'nodes', requiredQuantity: '2' },
        }),
      ],
    };
    const preview = buildSizingImpact(snapshot, run);
    const component = preview.rows.find((r) => r.itemId === 'node')!;
    expect(component.defaultSelected).toBe(false);
    expect(preview.selections).toEqual([]);
    expect(component.bundle).toEqual({ itemId: 'kit', name: 'Узел', proposedQuantity: '2' });
    expect(component.reason).toMatch(/компонент комплекта.*увеличьте количество комплектов до 2/i);
    expect(preview.warnings.join(' ')).toMatch(/Измените количество комплектов/);
    expect(() => applySizingSelections(snapshot, preview.rows, [{ itemId: 'node' }], run)).toThrow(
      /компонент комплекта/,
    );
  });
});
