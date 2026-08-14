import { describe, expect, it } from 'vitest';
import {
  calculateCommercialSummary,
  formatCurrency,
  resolveRoleRates,
  DEFAULT_ROLE_RATES,
} from '@/lib/commercial';

describe('lib/commercial', () => {
  describe('formatCurrency', () => {
    it('formats numbers with currency symbol in Russian locale', () => {
      expect(formatCurrency(1500000, 'RUB')).toContain('1\u00A0500\u00A0000 ₽');
      expect(formatCurrency(25000, 'USD')).toContain('25\u00A0000 $');
      expect(formatCurrency(1234.5, 'EUR', { decimals: 2 })).toContain('1\u00A0234,50 €');
    });
  });

  describe('resolveRoleRates', () => {
    it('falls back to default rates when empty', () => {
      const rates = resolveRoleRates(null);
      expect(rates.architect).toBe(DEFAULT_ROLE_RATES.architect);
      expect(rates.developer).toBe(DEFAULT_ROLE_RATES.developer);
    });

    it('overrides specific rates from object or JSON string', () => {
      const customRates = resolveRoleRates('{"developer": 4200, "architect": 6000}');
      expect(customRates.developer).toBe(4200);
      expect(customRates.architect).toBe(6000);
      expect(customRates.analyst).toBe(DEFAULT_ROLE_RATES.analyst);
    });
  });

  describe('calculateCommercialSummary', () => {
    it('calculates full breakdown with roles, PM, risks, overhead, margin, discount, and VAT', () => {
      const stages = [
        { hours: 40, role: 'developer', isApprovalTask: false },
        { hours: 20, role: 'analyst', isApprovalTask: false },
        { hours: 10, role: 'architect', isApprovalTask: false },
        { hours: 15, role: 'customer', isApprovalTask: true }, // approval task ignored for labor cost
      ];
      const pmHours = 10;
      const risks = [{ hours: 10 }];

      // custom rates
      const config = {
        currency: 'RUB',
        roleRates: {
          developer: 3000, // 40 * 3000 = 120 000
          analyst: 4000,   // 20 * 4000 = 80 000
          architect: 5000, // 10 * 5000 = 50 000
          pm: 4000,        // 10 * 4000 = 40 000
        },
        overheadPercent: 10,
        marginPercent: 20,
        discountPercent: 5,
        vatPercent: 20,
        includeVat: true,
      };

      const result = calculateCommercialSummary(stages, pmHours, risks, config);

      // Stages hours = 40 + 20 + 10 = 70h
      expect(result.stagesHours).toBe(70);
      // Stages cost = 120000 + 80000 + 50000 = 250 000
      expect(result.stagesCost).toBe(250000);

      // PM cost = 10 * 4000 = 40 000
      expect(result.pmCost).toBe(40000);

      // Direct labor before risks = 80h, cost = 290 000 -> blended rate = 290000 / 80 = 3625
      // Risk cost = 10 * 3625 = 36 250
      expect(result.riskHours).toBe(10);
      expect(result.riskCost).toBe(36250);

      // Direct labor total = 90h, cost = 326 250
      expect(result.directLaborHours).toBe(90);
      expect(result.directLaborCost).toBe(326250);

      // Overhead 10% = 32 625 -> Total cost = 358 875
      expect(result.overheadAmount).toBe(32625);
      expect(result.totalCost).toBe(358875);

      // Margin 20% on total cost = 358 875 * 0.20 = 71 775 -> Price before discount = 430 650
      expect(result.marginAmount).toBe(71775);
      expect(result.priceBeforeDiscount).toBe(430650);

      // Discount 5% = 430 650 * 0.05 = 21 533 -> Subtotal ex VAT = 409 117
      expect(result.discountAmount).toBe(21533);
      expect(result.subtotalExVat).toBe(409117);

      // VAT 20% = 409 117 * 0.2 = 81 823 -> Grand total = 490 940
      expect(result.vatAmount).toBe(81823);
      expect(result.grandTotal).toBe(490940);

      // Effective blended hourly rate = 409117 / 90 = 4546
      expect(result.blendedHourlyRate).toBe(4546);
    });

    it('handles zero VAT and zero discount cleanly', () => {
      const stages = [{ hours: 10, role: 'developer', isApprovalTask: false }];
      const result = calculateCommercialSummary(stages, 0, [], {
        includeVat: false,
        discountPercent: 0,
        marginPercent: 0,
        overheadPercent: 0,
        roleRates: { developer: 3000 },
      });

      expect(result.directLaborCost).toBe(30000);
      expect(result.subtotalExVat).toBe(30000);
      expect(result.vatAmount).toBe(0);
      expect(result.grandTotal).toBe(30000);
    });
  });
});
