import { prisma } from './prisma';

export interface CreateProjectInput {
  name: string;
  customer: string;
  code?: string;
  description?: string;
  status?: string;
  createdBy?: string;
}

export interface CreateCalculationVersionInput {
  parentCalculationId: string;
  versionComment?: string;
  name?: string;
  answers?: Record<string, unknown> | string;
  createdBy?: string;
}

export interface CreateGostPackageInput {
  calculationId: string;
  name: string;
  standardProfileId: string;
  standardProfileVersion: string;
  generatorVersion: string;
  documentTypes: string[];
  metadata?: Record<string, unknown> | string;
  checksum?: string;
  status?: string;
  createdBy?: string;
  projectId?: string;
}

/**
 * Creates or fetches an existing Project matching customer and project name.
 */
export async function getOrCreateProject(input: CreateProjectInput) {
  const existing = await prisma.project.findFirst({
    where: {
      customer: input.customer.trim(),
      name: input.name.trim(),
    },
    include: {
      calculations: {
        orderBy: { version: 'desc' },
      },
      packages: {
        orderBy: { version: 'desc' },
      },
    },
  });

  if (existing) {
    return existing;
  }

  return prisma.project.create({
    data: {
      name: input.name.trim(),
      customer: input.customer.trim(),
      code: input.code?.trim() || null,
      description: input.description?.trim() || null,
      status: input.status || 'active',
      createdBy: input.createdBy || 'presale',
    },
    include: {
      calculations: true,
      packages: true,
    },
  });
}

/**
 * Creates a new version (N+1) of an existing Calculation inside its project,
 * deeply cloning stages and risks while linking parentCalculationId.
 */
export async function createCalculationVersion(input: CreateCalculationVersionInput) {
  const source = await prisma.calculation.findUnique({
    where: { id: input.parentCalculationId },
    include: {
      stages: { orderBy: { order: 'asc' } },
      risks: { orderBy: { order: 'asc' } },
      project: true,
    },
  });

  if (!source) {
    throw new Error(`Calculation with ID ${input.parentCalculationId} not found`);
  }

  // Ensure Project association exists
  let projectId = source.projectId;
  if (!projectId) {
    const project = await getOrCreateProject({
      name: source.name,
      customer: source.customer,
      createdBy: source.createdBy,
    });
    projectId = project.id;
    // Link source to the project if not linked
    await prisma.calculation.update({
      where: { id: source.id },
      data: { projectId },
    });
  }

  // Determine highest version number in this project
  const latestInProject = await prisma.calculation.findFirst({
    where: { projectId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });

  const nextVersion = (latestInProject?.version ?? source.version) + 1;

  const answersJson =
    typeof input.answers === 'object'
      ? JSON.stringify(input.answers)
      : typeof input.answers === 'string'
        ? input.answers
        : source.answers;

  const newCalculation = await prisma.calculation.create({
    data: {
      name: input.name || source.name,
      customer: source.customer,
      templateId: source.templateId,
      answers: answersJson,
      status: 'draft',
      startDate: source.startDate,
      pmHours: source.pmHours,
      createdBy: input.createdBy || source.createdBy,
      projectId,
      version: nextVersion,
      parentCalculationId: source.id,
      versionComment:
        input.versionComment || `Версия ${nextVersion} от ${source.name} (v${source.version})`,
      standardProfileId: source.standardProfileId,
      standardProfileVersion: source.standardProfileVersion,
      generatorVersion: source.generatorVersion,
    },
  });

  // Deep clone stages
  if (source.stages.length > 0) {
    for (const stage of source.stages) {
      await prisma.stage.create({
        data: {
          calculationId: newCalculation.id,
          name: stage.name,
          role: stage.role,
          hours: stage.hours,
          order: stage.order,
          startDate: stage.startDate,
          endDate: stage.endDate,
          isApprovalTask: stage.isApprovalTask,
          approvalForStageId: stage.approvalForStageId,
          status: 'planned',
          dueDate: stage.dueDate,
          requirements: stage.requirements,
          parallel: stage.parallel,
          approvalDays: stage.approvalDays,
        },
      });
    }
  }

  // Deep clone risks
  if (source.risks.length > 0) {
    for (const risk of source.risks) {
      await prisma.risk.create({
        data: {
          calculationId: newCalculation.id,
          description: risk.description,
          hours: risk.hours,
          order: risk.order,
        },
      });
    }
  }

  return prisma.calculation.findUnique({
    where: { id: newCalculation.id },
    include: {
      stages: { orderBy: { order: 'asc' } },
      risks: { orderBy: { order: 'asc' } },
      project: true,
      parentCalculation: true,
    },
  });
}

/**
 * Releases a versioned GOST 34 document package for a calculation and its project.
 */
export async function createGostPackageVersion(input: CreateGostPackageInput) {
  const calculation = await prisma.calculation.findUnique({
    where: { id: input.calculationId },
    include: { project: true },
  });

  if (!calculation) {
    throw new Error(`Calculation with ID ${input.calculationId} not found`);
  }

  let projectId = input.projectId || calculation.projectId;
  if (!projectId) {
    const project = await getOrCreateProject({
      name: calculation.name,
      customer: calculation.customer,
      createdBy: calculation.createdBy,
    });
    projectId = project.id;
    await prisma.calculation.update({
      where: { id: calculation.id },
      data: { projectId },
    });
  }

  // Determine latest version for this project's packages
  const latestPackage = await prisma.gostPackage.findFirst({
    where: { projectId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });

  const nextVersion = (latestPackage?.version ?? 0) + 1;

  const metadataJson =
    typeof input.metadata === 'object'
      ? JSON.stringify(input.metadata)
      : typeof input.metadata === 'string'
        ? input.metadata
        : null;

  const docTypesJson = JSON.stringify(input.documentTypes);

  const pkg = await prisma.gostPackage.create({
    data: {
      projectId,
      calculationId: calculation.id,
      name: input.name || `Комплект ГОСТ 34 v${nextVersion}`,
      version: nextVersion,
      status: input.status || 'draft',
      standardProfileId: input.standardProfileId,
      standardProfileVersion: input.standardProfileVersion,
      generatorVersion: input.generatorVersion,
      documentTypes: docTypesJson,
      metadata: metadataJson,
      checksum: input.checksum || null,
      createdBy: input.createdBy || 'architect',
    },
  });

  // Update calculation binding stamps
  await prisma.calculation.update({
    where: { id: calculation.id },
    data: {
      standardProfileId: input.standardProfileId,
      standardProfileVersion: input.standardProfileVersion,
      generatorVersion: input.generatorVersion,
      generatedAt: new Date(),
    },
  });

  return pkg;
}

/**
 * Updates status of a released GOST 34 package (e.g. approved, rejected, under_review).
 */
export async function updateGostPackageStatus(
  packageId: string,
  status: 'draft' | 'under_review' | 'approved' | 'rejected' | 'archived',
  options?: { approvedBy?: string },
) {
  return prisma.gostPackage.update({
    where: { id: packageId },
    data: {
      status,
      approvedAt: status === 'approved' ? new Date() : undefined,
      approvedBy: status === 'approved' ? options?.approvedBy || 'architect' : undefined,
    },
  });
}

/**
 * Returns full project details with all calculation versions and GOST 34 packages.
 */
export async function getProjectDetails(projectId: string) {
  return prisma.project.findUnique({
    where: { id: projectId },
    include: {
      calculations: {
        orderBy: { version: 'desc' },
        include: {
          template: { select: { id: true, name: true } },
          stages: { orderBy: { order: 'asc' } },
          risks: { orderBy: { order: 'asc' } },
          gostPackages: { orderBy: { version: 'desc' } },
        },
      },
      packages: {
        orderBy: { version: 'desc' },
        include: {
          calculation: {
            select: { id: true, name: true, version: true, status: true },
          },
        },
      },
    },
  });
}

/**
 * Backfills orphaned calculations that do not have a projectId into Projects.
 */
export async function backfillProjects() {
  const orphanCalculations = await prisma.calculation.findMany({
    where: { projectId: null },
    orderBy: { createdAt: 'asc' },
  });

  let migratedCount = 0;
  for (const calc of orphanCalculations) {
    const project = await getOrCreateProject({
      name: calc.name,
      customer: calc.customer,
      createdBy: calc.createdBy,
    });

    await prisma.calculation.update({
      where: { id: calc.id },
      data: {
        projectId: project.id,
      },
    });

    // If calculation had GOST stamps recorded, create a baseline package if none exists
    if (calc.standardProfileId && calc.generatedAt) {
      const existingPkg = await prisma.gostPackage.findFirst({
        where: { calculationId: calc.id },
      });

      if (!existingPkg) {
        await createGostPackageVersion({
          calculationId: calc.id,
          projectId: project.id,
          name: `Комплект ГОСТ 34 (Архив) ${calc.name}`,
          standardProfileId: calc.standardProfileId,
          standardProfileVersion: calc.standardProfileVersion || '1.0',
          generatorVersion: calc.generatorVersion || '0.2.0',
          documentTypes: ['tz'],
          status: calc.status === 'approved' ? 'approved' : 'draft',
          createdBy: calc.createdBy,
        });
      }
    }

    migratedCount++;
  }

  return { migratedCalculations: migratedCount };
}
