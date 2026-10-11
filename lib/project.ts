import type { TzAuthorState } from './gost34/llm/tzAuthor/types';
import type { Prisma } from './generated/prisma/client';
import { prisma } from './prisma';
import { storePackageArtifact } from './gost34/storage';
import { countOpenBlockers } from './review/store';
import { normalizeDocumentTypes } from './review/workflow';
import {
  markSpecificationReleased,
  releasedSpecificationVersion,
  withSpecificationRelease,
} from './specification/store';

/**
 * Номера версий расчётов и комплектов — max+1 в проекте. Без блокировки два
 * параллельных создания получили бы один номер (уникального индекса нет:
 * исторические данные его не гарантируют), поэтому чтение max и вставка идут
 * под транзакционной advisory-блокировкой проекта.
 */
export async function lockVersionNumbers(
  db: Prisma.TransactionClient,
  kind: 'calculation' | 'package',
  projectId: string,
) {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`versions:${kind}:${projectId}`}))`;
}

/** Создание комплекта со следующим номером версии проекта под блокировкой. */
async function createPackageWithNextVersion<T>(
  projectId: string,
  create: (tx: Prisma.TransactionClient, nextVersion: number) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await lockVersionNumbers(tx, 'package', projectId);
    const latestPackage = await tx.gostPackage.findFirst({
      where: { projectId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    return create(tx, (latestPackage?.version ?? 0) + 1);
  });
}

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
  specificationVersion?: number | null;
  specification?: import('./specification/types').SpecificationSnapshot;
  version?: number;
  standardProfileId?: string;
  layoutProfileId?: string;
  docType?: string;
  contractNumber?: string;
  city?: string;
  requirements?: unknown[];
  /**
   * Проектный контекст, которым выпускался комплект. Без него снимок не
   * воспроизводит выпуск: разделы ТЗ строятся именно из контекста.
   */
  projectContext?: Record<string, unknown>;
  uploadedFiles?: string[];
  tzAuthor?: TzAuthorState;
  applicabilityOverrides?: Record<string, unknown>;
  manualLinks?: unknown[];
  signatures?: Record<string, string>;
  /**
   * Ручные правки разделов: `paragraphs` заменяет текст раздела, `appendParagraphs`
   * (фрагменты наборов решений, #103 WP-7b) дописывается после него.
   */
  sectionOverrides?: Record<
    string,
    { title?: string; paragraphs?: string[]; items?: string[]; appendParagraphs?: string[] }
  >;
  /** Редакция и решение, из которых взяты факты испытаний для ПСИ и акта (#103 WP-4b). */
  acceptance?: { packageId: string; packageVersion: number; decisionId: string | null };
  /** Проверки из наборов решений (#103 WP-7b): их критерии сведены в требования. */
  kitChecks?: import('./kitApplication/plan').KitCheckEntry[];
  /** Фрагменты документов из наборов решений: их абзацы — в sectionOverrides. */
  kitFragments?: import('./kitApplication/plan').KitFragmentEntry[];
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
  /**
   * The issued package contains the SPEC: mark its pinned confirmed BOM revision
   * released. Off by default so TZ-only or legacy downloads never freeze the BOM.
   */
  releaseSpecification?: boolean;
}

/**
 * Creates or fetches an existing Project matching customer and project name.
 */
export async function getOrCreateProject(
  input: CreateProjectInput,
  // Транзакция вызывающего: версия расчёта создаёт проект в той же транзакции.
  db: Prisma.TransactionClient = prisma,
) {
  const existing = await db.project.findFirst({
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

  return db.project.create({
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
export async function createCalculationVersion(
  input: CreateCalculationVersionInput,
  // Транзакция вызывающего: принятие запроса на изменение создаёт версию
  // атомарно вместе с остальными записями (lib/changeRequests/decisions.ts).
  // Без неё — своя транзакция: номер версии берётся под блокировкой.
  db?: Prisma.TransactionClient,
) {
  if (!db) {
    return prisma.$transaction((tx) => createCalculationVersionIn(input, tx), {
      timeout: 30000,
      maxWait: 10000,
    });
  }
  return createCalculationVersionIn(input, db);
}

async function createCalculationVersionIn(
  input: CreateCalculationVersionInput,
  db: Prisma.TransactionClient,
) {
  const source = await db.calculation.findUnique({
    where: { id: input.parentCalculationId },
    include: {
      stages: { orderBy: { order: 'asc' } },
      risks: { orderBy: { order: 'asc' } },
      costItems: { orderBy: { order: 'asc' } },
      project: true,
    },
  });

  if (!source) {
    throw new Error(`Calculation with ID ${input.parentCalculationId} not found`);
  }

  // Ensure Project association exists
  let projectId = source.projectId;
  if (!projectId) {
    const project = await getOrCreateProject(
      {
        name: source.name,
        customer: source.customer,
        createdBy: source.createdBy,
      },
      db,
    );
    projectId = project.id;
    // Link source to the project if not linked
    await db.calculation.update({
      where: { id: source.id },
      data: { projectId },
    });
  }

  // Determine highest version number in this project
  await lockVersionNumbers(db, 'calculation', projectId);
  const latestInProject = await db.calculation.findFirst({
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

  const newCalculation = await db.calculation.create({
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
      pricingMode: source.pricingMode,
      currency: source.currency,
      roleRates: source.roleRates,
      overheadPercent: source.overheadPercent,
      marginPercent: source.marginPercent,
      discountPercent: source.discountPercent,
      vatPercent: source.vatPercent,
      includeVat: source.includeVat,
      // #103 §4.3: порог маржи версии не меняется вслед за шаблоном. Редакции
      // спецификации принадлежат исходной версии, поэтому закрепление не копируется.
      minMarginPercent: source.minMarginPercent,
    },
  });

  // #103 §4.2: статьи затрат копируются как есть (точные десятичные значения).
  if (source.costItems.length > 0) {
    await db.costItem.createMany({
      data: source.costItems.map((c) => ({
        calculationId: newCalculation.id,
        kind: c.kind,
        description: c.description,
        quantity: c.quantity,
        unitCost: c.unitCost,
        currency: c.currency,
        exchangeRate: c.exchangeRate,
        exchangeRateDate: c.exchangeRateDate,
        exchangeRateSource: c.exchangeRateSource,
        specItemRef: c.specItemRef,
        order: c.order,
      })),
    });
  }

  // Deep clone stages. Ссылки между этапами (согласование → этап, явные
  // зависимости) переводятся на id клонов: id исходной версии в новой версии
  // указывали бы на чужой расчёт.
  const stageIdMap = new Map<string, string>();
  for (const stage of source.stages) {
    const created = await db.stage.create({
      data: {
        calculationId: newCalculation.id,
        name: stage.name,
        role: stage.role,
        hours: stage.hours,
        order: stage.order,
        startDate: stage.startDate,
        endDate: stage.endDate,
        isApprovalTask: stage.isApprovalTask,
        status: 'planned',
        dueDate: stage.dueDate,
        requirements: stage.requirements,
        parallel: stage.parallel,
        approvalDays: stage.approvalDays,
        originRef: stage.originRef,
      },
    });
    stageIdMap.set(stage.id, created.id);
  }
  for (const stage of source.stages) {
    const target = stage.approvalForStageId ? stageIdMap.get(stage.approvalForStageId) : null;
    if (target) {
      await db.stage.update({
        where: { id: stageIdMap.get(stage.id) },
        data: { approvalForStageId: target },
      });
    }
  }
  const dependencies = await db.stageDependency.findMany({
    where: { calculationId: source.id },
  });
  for (const dep of dependencies) {
    const fromStageId = stageIdMap.get(dep.fromStageId);
    const toStageId = stageIdMap.get(dep.toStageId);
    if (!fromStageId || !toStageId) continue;
    await db.stageDependency.create({
      data: {
        calculationId: newCalculation.id,
        fromStageId,
        toStageId,
        type: dep.type,
        lagDays: dep.lagDays,
      },
    });
  }

  // Deep clone risks
  if (source.risks.length > 0) {
    for (const risk of source.risks) {
      await db.risk.create({
        data: {
          calculationId: newCalculation.id,
          description: risk.description,
          hours: risk.hours,
          order: risk.order,
          originRef: risk.originRef,
        },
      });
    }
  }

  return db.calculation.findUnique({
    where: { id: newCalculation.id },
    include: {
      stages: { orderBy: { order: 'asc' } },
      risks: { orderBy: { order: 'asc' } },
      project: true,
      parentCalculation: true,
    },
  });
}

export interface CreateDraftPackageVersionInput {
  projectId: string;
  calculationId: string;
  name: string;
  standardProfileId: string;
  standardProfileVersion: string;
  generatorVersion: string;
  documentTypes: string[];
  metadata: string | null;
  snapshot: GostWizardSnapshot;
  createdBy: string;
}

/**
 * Черновая версия комплекта N+1 в переданной транзакции: без артефакта,
 * выпуска и отметки спецификации. Используется принятием запроса на изменение,
 * где версия расчёта, комплект и журнал пишутся атомарно.
 */
export async function createDraftPackageVersion(
  db: Prisma.TransactionClient,
  input: CreateDraftPackageVersionInput,
) {
  await lockVersionNumbers(db, 'package', input.projectId);
  const latestPackage = await db.gostPackage.findFirst({
    where: { projectId: input.projectId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  return db.gostPackage.create({
    data: {
      projectId: input.projectId,
      calculationId: input.calculationId,
      name: input.name,
      version: (latestPackage?.version ?? 0) + 1,
      status: 'draft',
      standardProfileId: input.standardProfileId,
      standardProfileVersion: input.standardProfileVersion,
      generatorVersion: input.generatorVersion,
      documentTypes: normalizeDocumentTypes(input.documentTypes),
      metadata: input.metadata,
      snapshot: JSON.stringify(input.snapshot),
      createdBy: input.createdBy,
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

  const metadataJson =
    typeof input.metadata === 'object'
      ? JSON.stringify(input.metadata)
      : typeof input.metadata === 'string'
        ? input.metadata
        : null;

  // Канонический порядок: ["pmi","tz"] и ["tz","pmi"] — одна линия ревью (#103).
  const docTypesJson = normalizeDocumentTypes(input.documentTypes);

  const snapshotJson =
    typeof input.snapshot === 'object'
      ? JSON.stringify(input.snapshot)
      : typeof input.snapshot === 'string'
        ? input.snapshot
        : null;

  // An issued package freezes the confirmed BOM revision it was built from;
  // the package row and the revision status are written atomically.
  const specificationVersion =
    input.releasedAt && input.releaseSpecification
      ? releasedSpecificationVersion(input.snapshot)
      : null;
  const versionProjectId = projectId;
  const pkg = await createPackageWithNextVersion(versionProjectId, async (db, nextVersion) => {
    const created = await db.gostPackage.create({
      data: {
        projectId: versionProjectId,
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
    if (specificationVersion !== null) {
      await markSpecificationReleased(calculation.id, specificationVersion, db);
    }
    return created;
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
/**
 * Черновик изменён другим источником (применение набора решений, другая
 * вкладка) после того, как студия его загрузила: сохранение затёрло бы чужие
 * изменения. Студия предлагает перезагрузить черновик.
 */
export class DraftConflictError extends Error {
  constructor() {
    super('Черновик комплекта изменён после загрузки студии: перезагрузите его');
  }
}

export async function saveGostPackageDraft(input: {
  calculationId: string;
  snapshot: GostWizardSnapshot | string;
  standardProfileId?: string;
  standardProfileVersion?: string;
  generatorVersion?: string;
  createdBy?: string;
  /**
   * Оптимистичная блокировка (#103 WP-7b): `updatedAt` черновика, который
   * загрузила студия (ISO), `null` — студия черновика не видела. Не совпало —
   * `DraftConflictError`. Не передано — без проверки (прежние клиенты).
   */
  expectedUpdatedAt?: string | null;
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

  const expected = input.expectedUpdatedAt;
  if (expected !== undefined) {
    const expectedTime = expected === null ? null : new Date(expected).getTime();
    const actualTime = existingDraft ? existingDraft.updatedAt.getTime() : null;
    if (expectedTime !== actualTime) throw new DraftConflictError();
  }

  if (existingDraft) {
    // Условная запись: черновик не изменился между чтением и записью.
    const res = await prisma.gostPackage.updateMany({
      where: {
        id: existingDraft.id,
        status: 'draft',
        ...(expected !== undefined ? { updatedAt: existingDraft.updatedAt } : {}),
      },
      data: {
        snapshot: snapshotJson,
        standardProfileId: input.standardProfileId || existingDraft.standardProfileId,
        standardProfileVersion:
          input.standardProfileVersion || existingDraft.standardProfileVersion,
        generatorVersion: input.generatorVersion || existingDraft.generatorVersion,
        updatedAt: new Date(),
      },
    });
    if (res.count === 0) throw new DraftConflictError();
    return prisma.gostPackage.findUniqueOrThrow({ where: { id: existingDraft.id } });
  }

  const draftProjectId = projectId;
  return createPackageWithNextVersion(draftProjectId, (db, nextVersion) =>
    db.gostPackage.create({
      data: {
        projectId: draftProjectId,
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
    }),
  );
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
 * Loads the studio working state: active draft (if any) and the latest released/reviewed package.
 */
export async function getGostPackageStudioState(calculationId: string) {
  const [draft, latestPackage] = await Promise.all([
    prisma.gostPackage.findFirst({
      where: {
        calculationId,
        status: 'draft',
      },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.gostPackage.findFirst({
      where: {
        calculationId,
        status: { not: 'draft' },
      },
      orderBy: [{ version: 'desc' }, { updatedAt: 'desc' }],
    }),
  ]);

  return { draft, latestPackage };
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
  /** The package contains SPEC (DOCX or SPEC.xlsx): release its pinned BOM revision. */
  releaseSpecification?: boolean;
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
  // Канонический порядок: ["pmi","tz"] и ["tz","pmi"] — одна линия ревью (#103).
  const docTypesJson = normalizeDocumentTypes(input.documentTypes);

  const releaseProjectId = projectId;
  const pkg = await createPackageWithNextVersion(releaseProjectId, (db, nextVersion) =>
    db.gostPackage.create({
      data: {
        projectId: releaseProjectId,
        calculationId: calculation.id,
        name:
          input.name ||
          `Комплект ГОСТ 34 v${nextVersion} (${input.documentTypes.join(', ').toUpperCase()})`,
        version: nextVersion,
        status: 'under_review',
        stageEnteredAt: new Date(),
        standardProfileId: input.standardProfileId,
        standardProfileVersion: input.standardProfileVersion,
        generatorVersion: input.generatorVersion,
        documentTypes: docTypesJson,
        snapshot: snapshotJson,
        releasedAt: new Date(),
        releasedBy: input.actorId || 'architect',
        createdBy: input.actorId || 'architect',
      },
    }),
  );

  try {
    const stored = await storePackageArtifact(projectId, pkg.id, input.zipBuffer);
    // Finalizing the package and releasing its BOM revision commit together; on any
    // failure the package is deleted below and the revision keeps its status.
    const updatedPkg = await withSpecificationRelease(
      calculation.id,
      input.releaseSpecification ? releasedSpecificationVersion(input.snapshot) : null,
      (db) =>
        db.gostPackage.update({
          where: { id: pkg.id },
          data: {
            artifactPath: stored.artifactPath,
            checksum: stored.checksum,
          },
        }),
    );

    await prisma.calculation.update({
      where: { id: calculation.id },
      data: {
        standardProfileId: input.standardProfileId,
        standardProfileVersion: input.standardProfileVersion,
        generatorVersion: input.generatorVersion,
        generatedAt: new Date(),
      },
    });

    // Архивируем предыдущие черновики этого расчёта, чтобы они не оставались
    // фантомными записями в очереди Студии после состоявшегося выпуска.
    await prisma.gostPackage.updateMany({
      where: {
        calculationId: calculation.id,
        status: 'draft',
        id: { not: pkg.id },
      },
      data: {
        status: 'archived',
        stageEnteredAt: new Date(),
      },
    });

    return updatedPkg;
  } catch (err) {
    try {
      await prisma.gostPackage.delete({ where: { id: pkg.id } });
    } catch (cleanupErr) {
      console.warn(`Не удалось удалить неуспешный пакет ${pkg.id}:`, cleanupErr);
    }
    throw err;
  }
}

/**
 * Отказ по правилам ревью, а не сбой сервера: комплект уже утверждён или в нём
 * остались открытые блокеры. Отдельный тип нужен, чтобы маршрут ответил 409, а
 * не 500 — иначе штатный отказ попадает в мониторинг как авария.
 */
export class GostReviewConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GostReviewConflictError';
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
 * страховка нужна и здесь: утвердить комплект мимо UI нельзя. Если вызывающий
 * не передал счётчик, он считается по таблице замечаний (#103): блокер,
 * отмеченный исправленным, но не проверенный, утверждение не пропускает.
 *
 * Персональное назначение на этап здесь не учитывается: оно не даёт права
 * подписи, решение закреплено за ролью этапа в маршруте `/review`.
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
    throw new GostReviewConflictError('Утверждённый комплект документов неизменяем.');
  }

  const openBlockers =
    input.decision === 'approve'
      ? (input.openBlockers ?? (await countOpenBlockers(pkg)))
      : (input.openBlockers ?? 0);
  if (input.decision === 'approve' && openBlockers > 0) {
    throw new GostReviewConflictError('Утверждение недоступно, пока открыт хотя бы один блокер.');
  }

  const stage = pkg.reviewStage === 'gap' ? 'gap' : 'tw';

  if (input.decision === 'reject') {
    return prisma.gostPackage.update({
      where: { id: pkg.id },
      data: {
        status: 'rejected',
        stageEnteredAt: new Date(),
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
        stageEnteredAt: new Date(),
        reviewComment: input.comment?.trim() || null,
      },
    });
  }

  return prisma.gostPackage.update({
    where: { id: pkg.id },
    data: {
      status: 'approved',
      reviewStage: 'done',
      stageEnteredAt: new Date(),
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
      stageEnteredAt: new Date(),
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
