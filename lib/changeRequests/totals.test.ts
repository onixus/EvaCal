import { describe, expect, it } from 'vitest';
import { summarizeChanges, sumDecimal, type AcceptedChangeInput } from './totals';

const baseline = {
  calculationId: 'c1',
  version: 1,
  currency: 'RUB',
  hours: 536,
  priceExVat: 1234567.89,
  plannedEnd: '2026-12-01T00:00:00.000Z',
};

const change = (over: Partial<AcceptedChangeInput>): AcceptedChangeInput => ({
  id: 'cr',
  seq: 1,
  title: 'SSO',
  confirmedHours: 24,
  confirmedCost: '36000.50',
  confirmedScheduleDays: 2,
  decidedAt: '2026-10-11T00:00:00.000Z',
  baseCalculationId: 'c1',
  resultCalculationId: 'c2',
  resultPackageId: 'p2',
  ...over,
});

const versions = {
  calculations: new Map([
    ['c1', 1],
    ['c2', 2],
    ['c3', 3],
  ]),
  packages: new Map([
    ['p2', 2],
    ['p3', 3],
  ]),
};

describe('sumDecimal', () => {
  it('суммирует до копейки без ошибок плавающей точки', () => {
    expect(sumDecimal(['0.10', '0.20'])).toBe('0.30');
    expect(sumDecimal(['100.5', '-0.51', '0'])).toBe('99.99');
    expect(sumDecimal(['-5', '2.25'])).toBe('-2.75');
    expect(sumDecimal([])).toBe('0.00');
  });
});

describe('summarizeChanges', () => {
  it('база отдельно, изменения по порядку решения, итог = база + изменения', () => {
    const s = summarizeChanges(
      baseline,
      [
        change({
          id: 'b',
          seq: 2,
          confirmedHours: -8,
          confirmedCost: '-10000.00',
          confirmedScheduleDays: -1,
          decidedAt: '2026-10-12T00:00:00.000Z',
          baseCalculationId: 'c2',
          resultCalculationId: 'c3',
          resultPackageId: null,
        }),
        change({ id: 'a' }),
      ],
      versions,
    );
    expect(s.baseline).toBe(baseline);
    expect(
      s.changes.map((c) => [c.seq, c.baseVersion, c.resultVersion, c.resultPackageVersion]),
    ).toEqual([
      [1, 1, 2, 2],
      [2, 2, 3, null],
    ]);
    expect(s.totals).toEqual({ hours: 16, cost: '26000.50', scheduleDays: 1 });
    expect(s.current).toEqual({ hours: 552, priceExVat: '1260568.39' });
  });

  it('без принятых изменений итог равен базе', () => {
    const s = summarizeChanges(baseline, [], versions);
    expect(s.totals).toEqual({ hours: 0, cost: '0.00', scheduleDays: 0 });
    expect(s.current).toEqual({ hours: 536, priceExVat: '1234567.89' });
  });

  it('без базы — только изменения', () => {
    const s = summarizeChanges(null, [change({})], versions);
    expect(s.current).toBeNull();
    expect(s.totals.hours).toBe(24);
  });
});
