import { describe, expect, it } from 'vitest';
import {
  applySizingSelections,
  buildSizingImpact,
  ceilQuantity,
  type SizingImpactRun,
} from './impact';
import { parseSpecification } from '../specification/validation';
import type { SpecificationItem, SpecificationSnapshot } from '../specification/types';
import type { SizingOutputValue } from './types';

const out = (key: string, value: number | null, missing: string[] = []): SizingOutputValue => ({
  key,
  label: key,
  kind: 'nodes',
  unit: 'шт.',
  value,
  missing,
  assumptions: [],
  basis: '',
});
const item = (over: Partial<SpecificationItem>): SpecificationItem => ({
  id: 'i',
  kind: 'hardware',
  disposition: 'supply',
  name: 'Узел NGFW',
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
  unitPrice: '100.50',
  currency: 'RUB',
  ...over,
});
const spec = (items: SpecificationItem[]): SpecificationSnapshot => ({
  version: 3,
  status: 'confirmed',
  emptySupplyReason: '',
  items,
});
const run = (outputs: SizingOutputValue[], id: string | null = 'run-2'): SizingImpactRun => ({
  id,
  source: 'profile',
  label: 'NGFW v2',
  outputs: { base: outputs, no_ha: [out('nodes', 1)] },
});

describe('sizing impact preview', () => {
  const linked = item({
    id: 'nodes',
    sizingRef: { runId: 'run-1', metric: 'nodes', requiredQuantity: '2' },
  });
  it('shows deficit with proposed quantity and exact cost delta', () => {
    const p = buildSizingImpact(spec([linked]), run([out('nodes', 4)]));
    const row = p.rows[0];
    expect(row).toMatchObject({
      status: 'deficit',
      newRequired: '4',
      linkedRequired: '2',
      balance: '-2',
      proposedQuantity: '4',
      amountDelta: '201',
      defaultSelected: true,
      manualQuantity: false,
    });
    expect(p.totals.before[0].total).toBe('201');
    expect(p.totals.after[0].total).toBe('402');
  });
  it('shows surplus when the new requirement shrinks', () => {
    const row = buildSizingImpact(spec([linked]), run([out('nodes', 1)])).rows[0];
    expect(row).toMatchObject({ status: 'surplus', proposedQuantity: '1', amountDelta: '-100.5' });
  });
  it('uses unit capacity: 4 TB per disk, 13 TB required → 4 disks', () => {
    const disks = item({
      id: 'disk',
      quantity: '3',
      sizingRef: {
        runId: 'run-1',
        metric: 'hot_storage',
        requiredQuantity: '12',
        unitCapacity: '4',
      },
    });
    const row = buildSizingImpact(spec([disks]), run([out('hot_storage', 13)])).rows[0];
    expect(row).toMatchObject({
      status: 'deficit',
      coverage: '12',
      balance: '-1',
      proposedQuantity: '4',
    });
  });
  it('missing characteristics or inputs → cannot verify, never success', () => {
    const unknown = buildSizingImpact(
      spec([linked]),
      run([out('nodes', null, ['ngfw_ha_required'])]),
    );
    expect(unknown.rows[0].status).toBe('unknown');
    expect(unknown.rows[0].reason).toContain('Невозможно проверить соответствие');
    expect(unknown.rows[0].reason).toContain('ngfw_ha_required');
    expect(unknown.rows[0].defaultSelected).toBe(false);
    expect(unknown.warnings.join(' ')).toContain('Это не успешный подбор');
    const absent = buildSizingImpact(spec([linked]), run([out('other', 1)]));
    expect(absent.rows[0].status).toBe('unknown');
    const noQty = buildSizingImpact(spec([{ ...linked, quantity: null }]), run([out('nodes', 4)]));
    expect(noQty.rows[0].status).toBe('unknown');
  });
  it('never touches unlinked or manual rows by default', () => {
    const manualRow = item({
      id: 'manual',
      quantity: '5',
      sizingRef: { runId: 'run-1', metric: 'nodes', requiredQuantity: '2' },
    });
    const free = item({ id: 'free', quantity: '7' });
    const s = spec([manualRow, free]);
    const p = buildSizingImpact(s, run([out('nodes', 4)]));
    expect(p.rows.find((r) => r.itemId === 'free')!.status).toBe('unlinked');
    const manual = p.rows.find((r) => r.itemId === 'manual')!;
    expect(manual).toMatchObject({
      manualQuantity: true,
      defaultSelected: false,
      status: 'surplus',
    });
    expect(p.selections).toEqual([]);
    expect(p.totals.after).toEqual(p.totals.before);
    // Without explicit consent the manual row keeps its quantity.
    const kept = applySizingSelections(s, p.rows, [{ itemId: 'manual' }], run([]));
    expect(kept.items[0].quantity).toBe('5');
    const forced = applySizingSelections(
      s,
      p.rows,
      [{ itemId: 'manual', allowManualOverride: true }],
      run([out('nodes', 4)]),
    );
    expect(forced.items[0].quantity).toBe('4');
    expect(forced.items[1]).toEqual(free);
  });
  it('apply produces a valid draft snapshot pinned to the new run', () => {
    const s = spec([linked]);
    const r = run([out('nodes', 4)]);
    const p = buildSizingImpact(s, r);
    const next = applySizingSelections(s, p.rows, p.selections, r);
    expect(next.status).toBe('draft');
    expect(next.items[0]).toMatchObject({
      quantity: '4',
      confirmed: false,
      sizingRef: { runId: 'run-2', metric: 'nodes', requiredQuantity: '4' },
    });
    expect(next.items[0].changeReason).toContain('2 → 4');
    expect(() => parseSpecification(next)).not.toThrow();
    // Original snapshot untouched.
    expect(s.items[0].quantity).toBe('2');
  });
  it('respects scenario of the link', () => {
    const ha = item({
      id: 'x',
      sizingRef: { runId: 'run-1', metric: 'nodes', scenario: 'no_ha', requiredQuantity: '2' },
    });
    const row = buildSizingImpact(spec([ha]), run([out('nodes', 4)])).rows[0];
    expect(row).toMatchObject({ scenario: 'no_ha', newRequired: '1', status: 'surplus' });
  });
  it('lists metrics not covered by any item', () => {
    const p = buildSizingImpact(
      spec([linked]),
      run([out('nodes', 2), out('target_throughput', 39)]),
    );
    expect(p.uncovered.map((u) => u.key)).toEqual(['target_throughput']);
    expect(p.rows[0].status).toBe('ok');
  });
});

describe('sizingRef validation (backward compatible)', () => {
  it('old snapshots without sizingRef still parse; invalid refs rejected', () => {
    expect(parseSpecification(spec([item({})])).items[0].sizingRef).toBeUndefined();
    const bad = (ref: unknown) => () =>
      parseSpecification(spec([item({ sizingRef: ref as never })]));
    expect(bad({ runId: 'r', metric: 'Nodes!', requiredQuantity: '1' })).toThrow();
    expect(bad({ runId: 'r', metric: 'nodes', requiredQuantity: '-1' })).toThrow();
    expect(
      bad({ runId: 'r', metric: 'nodes', requiredQuantity: '1', unitCapacity: '0' }),
    ).toThrow();
    expect(bad({ runId: 'r', metric: 'nodes', requiredQuantity: '1', extra: 1 })).toThrow();
    const ok = parseSpecification(
      spec([
        item({
          sizingRef: { runId: 'r', metric: 'nodes', scenario: 'base', requiredQuantity: '1' },
        }),
      ]),
    );
    expect(ok.items[0].sizingRef).toEqual({ runId: 'r', metric: 'nodes', requiredQuantity: '1' });
  });
});

describe('exact quantity arithmetic', () => {
  it('ceil division is exact for fractional and large values', () => {
    expect(ceilQuantity('0.5', '1000000000')).toBe('1');
    expect(ceilQuantity('1000000000', '0.5')).toBe('2000000000');
    expect(ceilQuantity('12', '4')).toBe('3');
    expect(ceilQuantity('12.000001', '4')).toBe('4');
    expect(ceilQuantity('0', '3')).toBe('0');
    // 18 significant digits: float division would lose the last unit.
    expect(ceilQuantity('999999999999.999999', '0.000001')).toBe('999999999999999999');
    expect(ceilQuantity('123456789012.345678', '1')).toBe('123456789013');
  });
  it('a quantity outside the specification range is "cannot verify", not success', () => {
    const row = buildSizingImpact(
      spec([
        item({
          id: 'big',
          quantity: '1',
          sizingRef: {
            runId: 'run-1',
            metric: 'nodes',
            requiredQuantity: '1',
            unitCapacity: '0.000001',
          },
        }),
      ]),
      run([out('nodes', 999999999999)]),
    ).rows[0];
    expect(row.status).toBe('unknown');
    expect(row.proposedQuantity).toBeNull();
  });
  it('deficit is never described as sufficient', () => {
    const linked = item({
      id: 'n',
      quantity: '2',
      sizingRef: { runId: 'run-1', metric: 'nodes', requiredQuantity: '2' },
    });
    const r = run([out('nodes', 2.5)]);
    const p = buildSizingImpact(spec([linked]), r);
    expect(p.rows[0]).toMatchObject({ status: 'deficit', proposedQuantity: '3' });
    const next = applySizingSelections(spec([linked]), p.rows, p.selections, r);
    expect(next.items[0].quantity).toBe('3');
    expect(next.items[0].changeReason).not.toContain('достаточно');
  });
});
