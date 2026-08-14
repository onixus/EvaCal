import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/auth';
import { safeJsonParse } from '@/lib/json';
import CalculationProjectHub from '@/components/CalculationProjectHub';

export const dynamic = 'force-dynamic';

export default async function CalculationViewPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  // Come back to this calculation after logging in, not to a section landing page.
  await requireRole(['architect', 'admin'], `/calculations/${params.id}`);
  const calculation = await prisma.calculation.findUnique({
    where: { id: params.id },
    include: {
      template: { include: { fields: { orderBy: { order: 'asc' } } } },
      stages: { orderBy: { order: 'asc' } },
      risks: { orderBy: { order: 'asc' } },
    },
  });
  if (!calculation) notFound();

  const answers = safeJsonParse<Record<string, unknown>>(calculation.answers, {});

  const serializedCalculation = {
    id: calculation.id,
    name: calculation.name,
    customer: calculation.customer,
    status: calculation.status,
    startDate: calculation.startDate.toISOString(),
    createdAt: calculation.createdAt.toISOString(),
    pmHours: calculation.pmHours,
    template: {
      name: calculation.template.name,
      fields: calculation.template.fields.map((f) => ({
        id: f.id,
        label: f.label,
        key: f.key,
      })),
    },
    stages: calculation.stages.map((s) => ({
      id: s.id,
      name: s.name,
      role: s.role,
      hours: s.hours,
      isApprovalTask: s.isApprovalTask,
      startDate: s.startDate.toISOString(),
      endDate: s.endDate.toISOString(),
      dueDate: s.dueDate ? s.dueDate.toISOString() : null,
      status: s.status,
      requirements: s.requirements,
      parallel: s.parallel,
      approvalDays: s.approvalDays,
    })),
    risks: calculation.risks.map((r) => ({
      id: r.id,
      description: r.description,
      hours: r.hours,
    })),
    answers,
    currency: calculation.currency,
    roleRates: calculation.roleRates,
    overheadPercent: calculation.overheadPercent,
    marginPercent: calculation.marginPercent,
    discountPercent: calculation.discountPercent,
    vatPercent: calculation.vatPercent,
    includeVat: calculation.includeVat,
  };

  return <CalculationProjectHub calculation={serializedCalculation} />;
}
