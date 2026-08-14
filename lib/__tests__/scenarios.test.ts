import { describe, expect, it } from 'vitest';
import { calculateScenarioVariations } from '@/lib/scenarios';
import { StageRow } from '@/components/StageTable';
import { RiskRow } from '@/components/TotalsSummary';

describe('lib/scenarios', () => {
  const mockStages: StageRow[] = [
    {
      id: 'st_1',
      name: 'Разработка',
      role: 'developer',
      hours: 100,
      isApprovalTask: false,
      parallel: false,
      approvalDays: 3,
      startDate: '2026-10-01',
      endDate: '2026-10-20',
      dueDate: null,
      status: 'planned',
      requirements: null,
    },
  ];
  const mockPmHours = 20;
  const mockRisks: RiskRow[] = [{ id: 'rk_1', description: 'Риск задержки', hours: 10 }];
  const commercialConfig = {
    roleRates: { developer: 3000, pm: 4000 },
    overheadPercent: 0,
    marginPercent: 0,
    discountPercent: 0,
    vatPercent: 0,
    includeVat: false,
  };

  it('computes 4 distinct scenario variations', () => {
    const result = calculateScenarioVariations(
      mockStages,
      mockPmHours,
      mockRisks,
      commercialConfig,
    );

    expect(result.all).toHaveLength(4);

    // Base: 100 stage + 20 PM + 10 Risk = 130h
    expect(result.base.stagesHours).toBe(100);
    expect(result.base.pmHours).toBe(20);
    expect(result.base.riskHours).toBe(10);
    expect(result.base.totalLaborHours).toBe(130);
    expect(result.base.diffVsBase.hours).toBe(0);
    expect(result.base.diffVsBase.hoursPercent).toBe(0);

    // Optimistic: 85 stage + 16 PM + 0 Risk = 101h (-29h, ~-22%)
    expect(result.optimistic.stagesHours).toBe(85);
    expect(result.optimistic.pmHours).toBe(16);
    expect(result.optimistic.riskHours).toBe(0);
    expect(result.optimistic.totalLaborHours).toBe(101);
    expect(result.optimistic.diffVsBase.hours).toBe(-29);
    expect(result.optimistic.diffVsBase.hoursPercent).toBe(-22);

    // Risk buffer: 100 stage + 24 PM + 15 Risk = 139h (+9h, ~+7%)
    expect(result.risk_buffer.stagesHours).toBe(100);
    expect(result.risk_buffer.pmHours).toBe(24);
    expect(result.risk_buffer.riskHours).toBe(15);
    expect(result.risk_buffer.totalLaborHours).toBe(139);
    expect(result.risk_buffer.diffVsBase.hours).toBe(9);

    // Pessimistic: 125 stage + 30 PM + 20 Risk = 175h (+45h, ~+35%)
    expect(result.pessimistic.stagesHours).toBe(125);
    expect(result.pessimistic.pmHours).toBe(30);
    expect(result.pessimistic.riskHours).toBe(20);
    expect(result.pessimistic.totalLaborHours).toBe(175);
    expect(result.pessimistic.diffVsBase.hours).toBe(45);
    expect(result.pessimistic.diffVsBase.hoursPercent).toBe(35);
  });

  it('correctly calculates commercial differences', () => {
    const result = calculateScenarioVariations(
      mockStages,
      mockPmHours,
      mockRisks,
      commercialConfig,
    );

    // Base cost: 100*3000 + 20*4000 + 10*3167 = 300 000 + 80 000 + 31 667 = ~411 667
    expect(result.base.commercial.grandTotal).toBeGreaterThan(350000);
    // Optimistic cost < Base cost
    expect(result.optimistic.commercial.grandTotal).toBeLessThan(result.base.commercial.grandTotal);
    // Pessimistic cost > Base cost
    expect(result.pessimistic.commercial.grandTotal).toBeGreaterThan(result.base.commercial.grandTotal);
    expect(result.pessimistic.diffVsBase.cost).toBeGreaterThan(0);
  });
});
