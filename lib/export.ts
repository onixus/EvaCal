import { prisma } from './prisma';
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
  marginPercent?: number;
  discountPercent?: number;
  vatPercent?: number;
  includeVat?: boolean;
}

/** Shared shape/query for the PDF, XLSX and JSON export routes. */
export async function loadCalculationForExport(id: string): Promise<CalculationForExport | null> {
  const calculation = await prisma.calculation.findUnique({
    where: { id },
    include: {
      template: { include: { fields: { orderBy: { order: 'asc' } } } },
      stages: { orderBy: { order: 'asc' } },
      risks: { orderBy: { order: 'asc' } },
    },
  });
  if (!calculation) return null;

  return {
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
    marginPercent: calculation.marginPercent,
    discountPercent: calculation.discountPercent,
    vatPercent: calculation.vatPercent,
    includeVat: calculation.includeVat,
  };
}

export { safeFileName, responseBody, contentDisposition } from './exportResponse';
