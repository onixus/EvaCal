import { describe, expect, it } from 'vitest';
import { approvalMatches, marginGate } from '@/lib/discountApproval';

const gate = (over: Partial<Parameters<typeof marginGate>[0]>) =>
  marginGate({
    minMarginPercent: 15,
    marginPercent: 20,
    incomplete: false,
    discountPercent: 5,
    approvals: [],
    ...over,
  });

describe('marginGate', () => {
  it('без порога и при марже не ниже порога согласование не нужно', () => {
    expect(gate({ minMarginPercent: null, marginPercent: 1 })).toMatchObject({
      state: 'no_threshold',
      requiresApproval: false,
    });
    expect(gate({ marginPercent: 15 })).toMatchObject({ state: 'ok', requiresApproval: false });
    expect(gate({ marginPercent: 14.996 })).toMatchObject({ state: 'ok' }); // 15.00 после округления
  });

  it('ниже порога — нужно согласование; подходит только одобренная заявка на ту же скидку', () => {
    const below = gate({ marginPercent: 10 });
    expect(below).toMatchObject({ state: 'below', requiresApproval: true, approved: false });
    expect(below.message).toContain('ниже порога 15%');
    const approvals = [
      { id: 'p', status: 'pending', requestedPercent: 5, resultingMargin: 10 },
      { id: 'other', status: 'approved', requestedPercent: 3, resultingMargin: 12 },
      { id: 'ok', status: 'approved', requestedPercent: 5, resultingMargin: 10 },
    ];
    expect(gate({ marginPercent: 10, approvals })).toMatchObject({
      approved: true,
      approvalId: 'ok',
    });
    // Маржа упала ниже согласованной — нужна новая заявка.
    expect(gate({ marginPercent: 9.5, approvals }).approved).toBe(false);
    // Скидка изменилась — тоже.
    expect(gate({ marginPercent: 10, discountPercent: 6, approvals }).approved).toBe(false);
  });

  it('неполные данные: маржа не определена, утверждение — только по заявке на неопределённую маржу', () => {
    const unknown = gate({ marginPercent: 30, incomplete: true });
    expect(unknown).toMatchObject({ state: 'unknown', requiresApproval: true, margin: null });
    expect(
      gate({
        incomplete: true,
        approvals: [{ id: 'a', status: 'approved', requestedPercent: 5, resultingMargin: null }],
      }).approved,
    ).toBe(true);
    expect(
      approvalMatches(
        { id: 'a', status: 'approved', requestedPercent: 5, resultingMargin: null },
        5,
        12,
      ),
    ).toBe(false);
  });
});
