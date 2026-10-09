import { describe, expect, it } from 'vitest';
import { calculateCommercialSummary, validateCommercialUpdate } from '@/lib/commercial';

const quote = (pricingMode: string, marginPercent = 20, discountPercent = 0, cost = 100) =>
  calculateCommercialSummary([{ hours: 1, role: 'developer' }], 0, [], {
    roleRates: { developer: cost },
    pricingMode,
    marginPercent,
    discountPercent,
    includeVat: false,
  });

describe('commercial pricing modes (#102)', () => {
  it('distinguishes cost markup from revenue margin', () => {
    expect(quote('markup').grandTotal).toBe(120);
    expect(quote('target_margin').grandTotal).toBe(125);
    expect(quote('markup').effectiveMarginPercent).toBeCloseTo(16.666667);
    expect(quote('target_margin').effectiveMarginPercent).toBe(20);
  });
  it('reports profit and effective margin after discount, excluding VAT', () => {
    const result = quote('target_margin', 20, 10);
    expect(result.subtotalExVat).toBe(112.5);
    expect(result.profitAfterDiscount).toBe(12.5);
    expect(result.effectiveMarginPercent).toBeCloseTo(11.111111);
  });
  it('reports losses and does not invent a margin for zero revenue', () => {
    expect(quote('markup', 20, 50).profitAfterDiscount).toBe(-40);
    expect(quote('markup', 20, 50).effectiveMarginPercent).toBeCloseTo(-66.666667);
    expect(quote('markup', 20, 100).effectiveMarginPercent).toBeNull();
    expect(quote('target_margin', 20, 0, 0).grandTotal).toBe(0);
    expect(quote('target_margin', 20, 0, 0).effectiveMarginPercent).toBeNull();
  });
  it('preserves old whole-unit rounding and defaults absent mode to legacy', () => {
    expect(quote('legacy_markup', 20, 0, 101.1).grandTotal).toBe(121.1);
    expect(quote('markup', 20, 0, 101.1).grandTotal).toBe(121.32);
    expect(calculateCommercialSummary([], 0, []).pricingMode).toBe('legacy_markup');
  });
  it('rounds margin price and discount separately to two decimals', () => {
    expect(quote('target_margin', 20, 0, 101.1).grandTotal).toBe(126.38);
    const result = quote('target_margin', 30, 10, 100.01);
    expect(result.priceBeforeDiscount).toBe(142.87);
    expect(result.discountAmount).toBe(14.29);
    expect(result.subtotalExVat).toBe(128.58);
    expect(result.profitAfterDiscount).toBe(28.57);
  });
  it.each([100, 101, -1, NaN, Infinity])('rejects invalid target margin %s', (percent) => {
    expect(() => quote('target_margin', percent)).toThrow();
  });
  it('allows zero margin and a finite value below 100', () => {
    expect(quote('target_margin', 0).grandTotal).toBe(100);
    expect(quote('target_margin', 99).grandTotal).toBe(10000);
  });
  it.each([
    { marginPercent: null },
    { marginPercent: '20' },
    { discountPercent: 101 },
    { pricingMode: 'unknown' },
    { overheadPercent: -1 },
    { includeVat: 'false' },
  ])('rejects malformed API input %j', (body) => {
    expect(() =>
      validateCommercialUpdate(body, { pricingMode: 'markup', marginPercent: 20 }),
    ).toThrow();
  });
  it('validates an existing percent when changing only the mode', () => {
    expect(() =>
      validateCommercialUpdate(
        { pricingMode: 'target_margin' },
        {
          pricingMode: 'legacy_markup',
          marginPercent: 100,
        },
      ),
    ).toThrow();
  });
});
