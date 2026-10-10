import { prisma } from './prisma';
import { loadSpecification } from './specification/store';
import { SpecificationError } from './specification/validation';
import { safeJsonParse } from './json';

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
}

/** Shared shape/query for the PDF, XLSX and JSON export routes. */
export async function loadCalculationForExport(
  id: string,
  specificationVersion?: number | null,
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

  return {
    specification: specification?.snapshot,
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
  };
}

export { safeFileName, responseBody, contentDisposition } from './exportResponse';
