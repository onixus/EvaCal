import { notFound } from 'next/navigation';
import { getProjectDetails } from '@/lib/project';
import ProjectDetailClient, { SerializedProject } from './ProjectDetailClient';

export const dynamic = 'force-dynamic';

export default async function ProjectDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const project = await getProjectDetails(params.id);

  if (!project) {
    notFound();
  }

  const serializedProject: SerializedProject = {
    id: project.id,
    name: project.name,
    customer: project.customer,
    code: project.code,
    description: project.description,
    status: project.status,
    createdBy: project.createdBy,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    calculations: project.calculations.map((c) => ({
      id: c.id,
      name: c.name,
      customer: c.customer,
      version: c.version,
      status: c.status,
      versionComment: c.versionComment,
      startDate: c.startDate.toISOString(),
      pmHours: c.pmHours,
      createdBy: c.createdBy,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      template: {
        id: c.template?.id || '',
        name: c.template?.name || 'Шаблон',
      },
      stages: c.stages.map((s) => ({
        id: s.id,
        name: s.name,
        role: s.role,
        hours: s.hours,
        isApprovalTask: s.isApprovalTask,
        order: s.order,
      })),
      risks: c.risks.map((r) => ({
        id: r.id,
        description: r.description,
        hours: r.hours,
        order: r.order,
      })),
      currency: c.currency,
      roleRates: c.roleRates,
      overheadPercent: c.overheadPercent,
      marginPercent: c.marginPercent,
      discountPercent: c.discountPercent,
      vatPercent: c.vatPercent,
      includeVat: c.includeVat,
      standardProfileId: c.standardProfileId,
      standardProfileVersion: c.standardProfileVersion,
      generatorVersion: c.generatorVersion,
    })),
    packages: project.packages.map((p) => ({
      id: p.id,
      name: p.name,
      version: p.version,
      status: p.status,
      calculationId: p.calculationId,
      calculation: p.calculation,
      standardProfileId: p.standardProfileId,
      standardProfileVersion: p.standardProfileVersion,
      generatorVersion: p.generatorVersion,
      documentTypes: p.documentTypes,
      metadata: p.metadata,
      checksum: p.checksum,
      approvedAt: p.approvedAt ? p.approvedAt.toISOString() : null,
      approvedBy: p.approvedBy,
      createdBy: p.createdBy,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    })),
  };

  return <ProjectDetailClient project={serializedProject} />;
}
