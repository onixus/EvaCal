import { describe, expect, it } from 'vitest';
import { approvalMatches, marginGate } from '@/lib/discountApproval';
import { offerFingerprint, type OfferTerms } from '@/lib/offerFingerprint';
import { calculateCommercialSummary } from '@/lib/commercial';
import { buildSupply, type CostItemInput } from '@/lib/supply';

const FP = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

const gate = (over: Partial<Parameters<typeof marginGate>[0]>) =>
  marginGate({
    minMarginPercent: 15,
    marginPercent: 20,
    incomplete: false,
    discountPercent: 5,
    fingerprint: FP,
    approvals: [],
    ...over,
  });

const row = (
  id: string,
  status: string,
  termsFingerprint: string,
  resultingMargin: number | null = 10,
) => ({
  id,
  status,
  requestedPercent: 5,
  resultingMargin,
  termsFingerprint,
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

  it('ниже порога — подходит только одобренная заявка с тем же отпечатком условий', () => {
    const below = gate({ marginPercent: 10 });
    expect(below).toMatchObject({ state: 'below', requiresApproval: true, approved: false });
    expect(below.message).toContain('ниже порога 15%');
    const approvals = [
      row('p', 'pending', FP),
      row('old', 'approved', OTHER),
      row('ok', 'approved', FP),
    ];
    expect(gate({ marginPercent: 10, approvals })).toMatchObject({
      approved: true,
      approvalId: 'ok',
    });
    // Любое изменение условий меняет отпечаток — нужна новая заявка.
    expect(
      gate({ marginPercent: 10, fingerprint: OTHER, approvals: [row('ok', 'approved', FP)] })
        .approved,
    ).toBe(false);
  });

  it('неопределённая маржа: согласование тоже привязано к отпечатку, а не действует бессрочно', () => {
    const unknown = gate({ marginPercent: 30, incomplete: true });
    expect(unknown).toMatchObject({ state: 'unknown', requiresApproval: true, margin: null });
    const approved = [row('a', 'approved', FP, null)];
    expect(gate({ incomplete: true, approvals: approved }).approved).toBe(true);
    expect(gate({ incomplete: true, fingerprint: OTHER, approvals: approved }).approved).toBe(
      false,
    );
    expect(approvalMatches(row('a', 'rejected', FP), FP)).toBe(false);
  });
});

describe('offerFingerprint', () => {
  const cost = (over: Partial<CostItemInput> = {}): CostItemInput => ({
    id: 'c1',
    kind: 'travel',
    description: 'Командировка',
    quantity: '1',
    unitCost: null,
    currency: 'RUB',
    exchangeRate: null,
    exchangeRateDate: null,
    exchangeRateSource: null,
    specItemRef: null,
    order: 0,
    ...over,
  });
  const terms = (over: Partial<OfferTerms> = {}): OfferTerms => ({
    pinnedSpecificationVersion: null,
    costItems: [cost()],
    pricingMode: 'markup',
    marginPercent: 20,
    overheadPercent: 0,
    discountPercent: 30,
    vatPercent: 20,
    includeVat: true,
    currency: 'RUB',
    roleRates: '{"developer":1000}',
    error: null,
    ...over,
  });
  const fp = (t: OfferTerms) => {
    const supply = buildSupply({
      currency: 'RUB',
      vatPercent: 20,
      includeVat: true,
      specification: null,
      costItems: t.costItems,
    });
    const summary = calculateCommercialSummary([{ hours: 10, role: 'developer' }], 0, [], {
      ...t,
      supply,
    });
    return offerFingerprint(t, summary);
  };

  it('стабилен для тех же условий и меняется при любом изменении — и при неизвестной марже', () => {
    const base = fp(terms());
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(fp(terms())).toBe(base);
    for (const changed of [
      terms({ discountPercent: 31 }),
      terms({ marginPercent: 21 }),
      terms({ pricingMode: 'target_margin' }),
      terms({ pinnedSpecificationVersion: 2 }),
      terms({ costItems: [cost({ description: 'Командировка ×2' })] }),
      terms({ costItems: [cost(), cost({ id: 'c2', unitCost: '1' })] }),
      terms({ costItems: [cost({ unitCost: '5' })] }), // неизвестное стало известным
      terms({ roleRates: '{"developer":1100}' }),
    ]) {
      expect(fp(changed)).not.toBe(base);
    }
  });
});
