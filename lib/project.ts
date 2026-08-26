import { prisma } from './prisma';
import { storePackageArtifact } from './gost34/storage';

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

export interface GostWizardSnapshot {
  version?: number;
  standardProfileId?: string;
  layoutProfileId?: string;
  docType?: string;
  contractNumber?: string;
  city?: string;
  requirements?: unknown[];
  uploadedFiles?: string[];
  applicabilityOverrides?: Record<string, unknown>;
  manualLinks?: unknown[];
  signatures?: Record<string, string>;
  sectionOverrides?: Record<string, { title?: string; paragraphs?: string[]; items?: string[] }>;
  activeStep?: string;
  updatedAt?: string;
}

export interface CreateGostPackageInput {
  calculationId: string;
  name?: string;
  standardProfileId: string;
  standardProfileVersion: string;
  generatorVersion: string;
  documentTypes: string[];
  metadata?: Record<string, unknown> | string;
  snapshot?: GostWizardSnapshot | string;
  artifactPath?: string;
  checksum?: string;
  status?: string;
  createdBy?: string;
  releasedBy?: string;
  releasedAt?: Date;
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

  const snapshotJson =
    typeof input.snapshot === 'object'
      ? JSON.stringify(input.snapshot)
      : typeof input.snapshot === 'string'
        ? input.snapshot
        : null;

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
      snapshot: snapshotJson,
      artifactPath: input.artifactPath || null,
      checksum: input.checksum || null,
      releasedAt: input.releasedAt || null,
      releasedBy: input.releasedBy || null,
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
 * Saves or updates a draft snapshot of wizard decisions on a GostPackage.
 */
export async function saveGostPackageDraft(input: {
  calculationId: string;
  snapshot: GostWizardSnapshot | string;
  standardProfileId?: string;
  standardProfileVersion?: string;
  generatorVersion?: string;
  createdBy?: string;
}) {
  const calculation = await prisma.calculation.findUnique({
    where: { id: input.calculationId },
    include: { project: true },
  });

  if (!calculation) {
    throw new Error(`Calculation with ID ${input.calculationId} not found`);
  }

  let projectId = calculation.projectId;
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

  const snapshotJson =
    typeof input.snapshot === 'string' ? input.snapshot : JSON.stringify(input.snapshot);

  const existingDraft = await prisma.gostPackage.findFirst({
    where: {
      calculationId: input.calculationId,
      status: 'draft',
    },
    orderBy: { version: 'desc' },
  });

  if (existingDraft) {
    return prisma.gostPackage.update({
      where: { id: existingDraft.id },
      data: {
        snapshot: snapshotJson,
        standardProfileId: input.standardProfileId || existingDraft.standardProfileId,
        standardProfileVersion:
          input.standardProfileVersion || existingDraft.standardProfileVersion,
        generatorVersion: input.generatorVersion || existingDraft.generatorVersion,
        updatedAt: new Date(),
      },
    });
  }

  const latestPackage = await prisma.gostPackage.findFirst({
    where: { projectId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const nextVersion = (latestPackage?.version ?? 0) + 1;

  return prisma.gostPackage.create({
    data: {
      projectId,
      calculationId: input.calculationId,
      name: `Черновик комплекта ГОСТ 34 v${nextVersion}`,
      version: nextVersion,
      status: 'draft',
      standardProfileId: input.standardProfileId || 'ru-gost34-current',
      standardProfileVersion: input.standardProfileVersion || '2020',
      generatorVersion: input.generatorVersion || '0.3.0',
      documentTypes: JSON.stringify(['tz']),
      snapshot: snapshotJson,
      createdBy: input.createdBy || 'architect',
    },
  });
}

/**
 * Loads the latest draft wizard snapshot for a calculation.
 */
export async function getGostPackageDraft(calculationId: string) {
  return prisma.gostPackage.findFirst({
    where: {
      calculationId,
      status: 'draft',
    },
    orderBy: { updatedAt: 'desc' },
  });
}

/**
 * Releases a finalized GOST 34 package: stores immutable ZIP on disk, sets SHA-256 and marks under_review.
 */
export async function releaseGostPackage(input: {
  calculationId: string;
  name?: string;
  standardProfileId: string;
  standardProfileVersion: string;
  generatorVersion: string;
  documentTypes: string[];
  snapshot: GostWizardSnapshot | string;
  zipBuffer: Buffer | Uint8Array;
  actorId?: string;
}) {
  const calculation = await prisma.calculation.findUnique({
    where: { id: input.calculationId },
    include: { project: true },
  });

  if (!calculation) {
    throw new Error(`Calculation with ID ${input.calculationId} not found`);
  }

  let projectId = calculation.projectId;
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

  const latestPackage = await prisma.gostPackage.findFirst({
    where: { projectId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const nextVersion = (latestPackage?.version ?? 0) + 1;

  const snapshotJson =
    typeof input.snapshot === 'string' ? input.snapshot : JSON.stringify(input.snapshot);
  const docTypesJson = JSON.stringify(input.documentTypes);

  const pkg = await prisma.gostPackage.create({
    data: {
      projectId,
      calculationId: calculation.id,
      name:
        input.name ||
        `Комплект ГОСТ 34 v${nextVersion} (${input.documentTypes.join(', ').toUpperCase()})`,
      version: nextVersion,
      status: 'under_review',
      standardProfileId: input.standardProfileId,
      standardProfileVersion: input.standardProfileVersion,
      generatorVersion: input.generatorVersion,
      documentTypes: docTypesJson,
      snapshot: snapshotJson,
      releasedAt: new Date(),
      releasedBy: input.actorId || 'architect',
      createdBy: input.actorId || 'architect',
    },
  });

  try {
    const stored = await storePackageArtifact(projectId, pkg.id, input.zipBuffer);
    const updatedPkg = await prisma.gostPackage.update({
      where: { id: pkg.id },
      data: {
        artifactPath: stored.artifactPath,
        checksum: stored.checksum,
      },
    });

    await prisma.calculation.update({
      where: { id: calculation.id },
      data: {
        standardProfileId: input.standardProfileId,
        standardProfileVersion: input.standardProfileVersion,
        generatorVersion: input.generatorVersion,
        generatedAt: new Date(),
      },
    });

    return updatedPkg;
  } catch (err) {
    await prisma.gostPackage.delete({ where: { id: pkg.id } }).catch(() => {});
    throw err;
  }
}

/**
 * Решение по комплекту ГОСТ 34 на текущем этапе ревью.
 *
 * Ревью двухэтапное: нормоконтроль тех.писателя (`tw`), затем финальное ревью
 * ГАП (`gap`). «Утвердить» на первом этапе не выпускает комплект, а передаёт
 * его на второй — утверждает только ГАП. «Вернуть с замечаниями» на любом
 * этапе отклоняет выпуск и возвращает комплект автору.
 *
 * Блокеры проверяются вызывающей стороной (ей видны чек-лист и комментарии), но
 * страховка нужна и здесь: утвердить комплект мимо UI нельзя.
 */
export async function reviewGostPackage(input: {
  packageId: string;
  decision: 'approve' | 'reject';
  actorId?: string;
  comment?: string;
  /** Открытые блокеры на момент решения; при них утверждение запрещено. */
  openBlockers?: number;
}) {
  const pkg = await prisma.gostPackage.findUnique({
    where: { id: input.packageId },
  });

  if (!pkg) {
    throw new Error(`GostPackage with ID ${input.packageId} not found`);
  }

  if (pkg.status === 'approved') {
    throw new Error('Утверждённый комплект документов неизменяем.');
  }

  if (input.decision === 'approve' && (input.openBlockers ?? 0) > 0) {
    throw new Error('Утверждение недоступно, пока открыт хотя бы один блокер.');
  }

  const stage = pkg.reviewStage === 'gap' ? 'gap' : 'tw';

  if (input.decision === 'reject') {
    return prisma.gostPackage.update({
      where: { id: pkg.id },
      data: {
        status: 'rejected',
        // Этап не сбрасывается: вернувшись после правок, комплект продолжает
        // с того места, где его отклонили, а не начинает нормоконтроль заново.
        reviewComment: input.comment?.trim() || null,
      },
    });
  }

  // Утверждение тех.писателем — это передача на второй этап, а не выпуск.
  if (stage === 'tw') {
    return prisma.gostPackage.update({
      where: { id: pkg.id },
      data: {
        status: 'under_review',
        reviewStage: 'gap',
        reviewComment: input.comment?.trim() || null,
      },
    });
  }

  return prisma.gostPackage.update({
    where: { id: pkg.id },
    data: {
      status: 'approved',
      reviewStage: 'done',
      approvedAt: new Date(),
      approvedBy: input.actorId || 'reviewer',
      reviewComment: input.comment?.trim() || null,
    },
  });
}

/**
 * Updates status of a released GOST 34 package (e.g. approved, rejected, under_review).
 */
export async function updateGostPackageStatus(
  packageId: string,
  status: 'draft' | 'under_review' | 'approved' | 'rejected' | 'archived',
  options?: { approvedBy?: string; reviewComment?: string },
) {
  return prisma.gostPackage.update({
    where: { id: packageId },
    data: {
      status,
      approvedAt: status === 'approved' ? new Date() : undefined,
      approvedBy: status === 'approved' ? options?.approvedBy || 'architect' : undefined,
      reviewComment: options?.reviewComment,
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
