import { prisma } from './prisma';
import { loadSpecification } from './specification/store';
import { SpecificationError } from './specification/validation';
import { safeJsonParse } from './json';
import { loadSupply } from './commercialContourData';
import type { SupplyBreakdown } from './supply';

export interface StageForExport {
  name: string;
  role: string;
  hours: number;
  isApprovalTask: boolean;
  parallel: boolean;
  approvalDays: number | null;
  startDate: Date;
  endDate: Date;
  dueDate: Date | null;
  status: string;
  requirements: string | null;
}

export interface RiskForExport {
  description: string;
  hours: number;
}

export interface FieldForExport {
  label: string;
  key: string;
}

export interface CalculationForExport {
  specification?: import('@/lib/specification/types').SpecificationSnapshot;
  /** Live catalog state of evidence copied into a non-released specification revision. */
  evidenceLive?: import('@/lib/catalog/compliance').EvidenceLive;
  id?: string;
  name: string;
  customer: string;
  status: string;
  startDate: Date;
  pmHours: number;
  templateName: string;
  answers: Record<string, unknown>;
  fields: FieldForExport[];
  stages: StageForExport[];
  risks: RiskForExport[];
  // Commercial fields (Horizon B4)
  currency?: string;
  roleRates?: string | null;
  overheadPercent?: number;
  pricingMode?: string;
  marginPercent?: number;
  discountPercent?: number;
  vatPercent?: number;
  includeVat?: boolean;
  /** #103 §4.2: поставка и статьи затрат КП; null/undefined — только труд. */
  supply?: SupplyBreakdown | null;
  /** Поставку не удалось рассчитать (например, закреплённая редакция недоступна). */
  supplyError?: string | null;
}

/** Shared shape/query for the PDF, XLSX and JSON export routes. */
export async function loadCalculationForExport(
  id: string,
  specificationVersion?: number | null,
  // Поставка и статьи нужны только КП (PDF/XLSX); JSON и комплекты ГОСТ 34 их не
  // читают и не должны ломаться из-за ошибок коммерческого контура.
  options: { withSupply?: boolean } = {},
): Promise<CalculationForExport | null> {
  const calculation = await prisma.calculation.findUnique({
    where: { id },
    include: {
      template: { include: { fields: { orderBy: { order: 'asc' } } } },
      stages: { orderBy: { order: 'asc' } },
      risks: { orderBy: { order: 'asc' } },
    },
  });
  if (!calculation) return null;

  // null pins the absence of a BOM; undefined retains the legacy latest lookup.
  const specification =
    specificationVersion === null ? null : await loadSpecification(id, specificationVersion);
  if (typeof specificationVersion === 'number' && !specification) {
    throw new SpecificationError('Редакция спецификации не найдена', 404);
  }

  // Released revisions are immutable documents: their copies are not compared to the catalog.
  let evidenceLive: CalculationForExport['evidenceLive'];
  if (specification && specification.snapshot.status !== 'released') {
    const ids = [
      ...new Set(
        specification.snapshot.items.flatMap((item) => (item.evidence ?? []).map((e) => e.id)),
      ),
    ];
    if (ids.length) {
      const rows = await prisma.complianceEvidence.findMany({
        where: { id: { in: ids } },
        select: { id: true, revision: true, archivedAt: true },
      });
      evidenceLive = Object.fromEntries(
        rows.map((row) => [row.id, { revision: row.revision, archived: row.archivedAt !== null }]),
      );
    }
  }

  return {
    specification: specification?.snapshot,
    ...(evidenceLive ? { evidenceLive } : {}),
    id: calculation.id,
    name: calculation.name,
    customer: calculation.customer,
    status: calculation.status,
    startDate: calculation.startDate,
    pmHours: calculation.pmHours,
    templateName: calculation.template.name,
    answers: safeJsonParse<Record<string, unknown>>(calculation.answers, {}),
    fields: calculation.template.fields,
    stages: calculation.stages,
    risks: calculation.risks,
    currency: calculation.currency,
    roleRates: calculation.roleRates,
    overheadPercent: calculation.overheadPercent,
    pricingMode: calculation.pricingMode,
    marginPercent: calculation.marginPercent,
    discountPercent: calculation.discountPercent,
    vatPercent: calculation.vatPercent,
    includeVat: calculation.includeVat,
    ...(options.withSupply ? await supplyForExport(calculation) : {}),
  };
}

async function supplyForExport(calculation: Parameters<typeof loadSupply>[0]) {
  try {
    return { supply: await loadSupply(calculation), supplyError: null };
  } catch (error) {
    return {
      supply: null,
      supplyError: error instanceof Error ? error.message : 'Поставка не рассчитана',
    };
  }
}

export { safeFileName, responseBody, contentDisposition } from './exportResponse';
