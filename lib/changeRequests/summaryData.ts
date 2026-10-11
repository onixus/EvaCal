import { prisma } from '@/lib/prisma';
import { calculateCommercialSummary } from '@/lib/commercial';
import { grandTotalHours } from '@/lib/totals';
import { summarizeChanges, type BaselineFigures, type ChangeSummary } from './totals';

/**
 * Первоначальная база + принятые изменения проекта для карточки проекта и
 * коммерческой сводки. База — `Project.baselineCalculationId`, а до первого
 * принятого изменения — выигранная версия (`wonCalculationId`).
 */

interface CalculationForBaseline {
  id: string;
  version: number;
  currency: string;
  pmHours: number;
  roleRates: string | null;
  overheadPercent: number;
  pricingMode: string;
  marginPercent: number;
  discountPercent: number;
  vatPercent: number;
  includeVat: boolean;
  stages: Array<{ hours: number; role: string; isApprovalTask: boolean; endDate: Date }>;
  risks: Array<{ hours: number }>;
}

export function baselineFigures(calc: CalculationForBaseline): BaselineFigures {
  const commercial = calculateCommercialSummary(calc.stages, calc.pmHours, calc.risks, {
    currency: calc.currency,
    roleRates: calc.roleRates,
    overheadPercent: calc.overheadPercent,
    pricingMode: calc.pricingMode,
    marginPercent: calc.marginPercent,
    discountPercent: calc.discountPercent,
    vatPercent: calc.vatPercent,
    includeVat: calc.includeVat,
  });
  const ends = calc.stages.map((s) => s.endDate.getTime());
  return {
    calculationId: calc.id,
    version: calc.version,
    currency: calc.currency,
    hours: Math.round(grandTotalHours(calc.stages, calc.pmHours, calc.risks) * 100) / 100,
    priceExVat: Math.round(commercial.subtotalExVat * 100) / 100,
    plannedEnd: ends.length ? new Date(Math.max(...ends)).toISOString() : null,
  };
}

export async function loadChangeSummary(project: {
  id: string;
  baselineCalculationId: string | null;
  wonCalculationId: string | null;
  calculations: CalculationForBaseline[];
  packages: Array<{ id: string; version: number }>;
}): Promise<ChangeSummary> {
  const accepted = await prisma.changeRequest.findMany({
    where: { projectId: project.id, status: 'accepted' },
    select: {
      id: true,
      seq: true,
      title: true,
      confirmedHours: true,
      confirmedCost: true,
      confirmedScheduleDays: true,
      decidedAt: true,
      baseCalculationId: true,
      resultCalculationId: true,
      resultPackageId: true,
    },
  });
  const baselineId = project.baselineCalculationId ?? project.wonCalculationId;
  const baselineCalc = baselineId ? project.calculations.find((c) => c.id === baselineId) : null;
  return summarizeChanges(
    baselineCalc ? baselineFigures(baselineCalc) : null,
    accepted.map((cr) => ({
      ...cr,
      confirmedCost: cr.confirmedCost === null ? null : cr.confirmedCost.toFixed(2),
      decidedAt: cr.decidedAt ? cr.decidedAt.toISOString() : null,
    })),
    {
      calculations: new Map(project.calculations.map((c) => [c.id, c.version])),
      packages: new Map(project.packages.map((p) => [p.id, p.version])),
      // Цена версии-результата по её ставкам — рядом с подтверждённой стоимостью,
      // чтобы разница (строка ИЗМ тарифицируется как риск) была видна.
      prices: new Map(
        accepted
          .map((cr) => project.calculations.find((c) => c.id === cr.resultCalculationId))
          .filter((c): c is CalculationForBaseline => !!c)
          .map((c) => [c.id, baselineFigures(c).priceExVat]),
      ),
    },
  );
}
