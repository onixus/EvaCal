import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  primaryStagesFromTemplate,
  rebuildStages,
  pmHoursFor,
  scheduleConfigFromTemplate,
  risksFromTemplate,
} from '@/lib/calc';
import { grandTotalHours } from '@/lib/totals';
import { pageArgs, paginationHeaders, parseLimit, parsePage } from '@/lib/pagination';
import { createShareToken, requireCalcAccess, requireInternalRole } from '@/lib/access';
import { actorTypeFromAccess, clientIp, writeAudit } from '@/lib/audit';
import { getOrCreateProject } from '@/lib/project';

// Список виден всем вошедшим сотрудникам (пресейл, архитектор, ревьювер,
// админ), но не гостям по ссылке: анонимной выгрузки коммерческого архива нет.
export async function GET(req: NextRequest) {
  const auth = await requireInternalRole(['read']);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(req.url);
  const limit = parseLimit(searchParams.get('limit'));
  const page = parsePage(searchParams.get('page') ?? undefined);

  const [total, calculations] = await Promise.all([
    prisma.calculation.count(),
    prisma.calculation.findMany({
      ...pageArgs(page, limit),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        template: { select: { name: true } },
        stages: { select: { hours: true, isApprovalTask: true, endDate: true } },
        risks: { select: { hours: true } },
      },
    }),
  ]);
  const summarized = calculations.map((c) => ({
    id: c.id,
    name: c.name,
    customer: c.customer,
    status: c.status,
    templateName: c.template.name,
    totalHours: grandTotalHours(c.stages, c.pmHours, c.risks),
    stageCount: c.stages.filter((s) => !s.isApprovalTask).length,
    startDate: c.startDate,
    endDate: c.stages.reduce<Date | null>((latest, s) => {
      const end = new Date(s.endDate);
      return !latest || end > latest ? end : latest;
    }, null),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }));
  return NextResponse.json(summarized, { headers: paginationHeaders(total, page, limit) });
}

// Create: staff, or share with `create`, or ALLOW_ANONYMOUS_PRESALE.
export async function POST(req: NextRequest) {
  const access = await requireCalcAccess(req, null, ['create']);
  if (access instanceof NextResponse) return access;

  const body = await req.json();
  const { name, customer, templateId, answers, startDate } = body;
  if (!name || !customer || !templateId) {
    return NextResponse.json(
      { error: 'name, customer and templateId are required' },
      { status: 400 },
    );
  }

  if (
    access.kind === 'share' &&
    access.share?.templateId &&
    access.share.templateId !== templateId
  ) {
    return NextResponse.json({ error: 'Share-токен выдан на другой шаблон' }, { status: 403 });
  }

  const template = await prisma.formTemplate.findUnique({
    where: { id: templateId },
    include: { stageTemplates: true, fields: true, riskTemplates: true },
  });
  if (!template) return NextResponse.json({ error: 'template not found' }, { status: 404 });

  const start = template.defaultStartDate ?? (startDate ? new Date(startDate) : new Date());
  const answersObj = answers ?? {};

  const primary = primaryStagesFromTemplate(template.stageTemplates, answersObj);
  const pmHours = pmHoursFor(template.fields, answersObj, primary);

  const createdBy =
    access.kind === 'staff'
      ? access.session?.username || access.actorId
      : access.kind === 'share'
        ? 'presale-share'
        : 'presale';

  let targetProjectId = body.projectId;
  if (!targetProjectId) {
    const project = await getOrCreateProject({
      name,
      customer,
      createdBy,
    });
    targetProjectId = project.id;
  }

  const latestInProject = await prisma.calculation.findFirst({
    where: { projectId: targetProjectId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const version = (latestInProject?.version ?? 0) + 1;

  const calculation = await prisma.calculation.create({
    data: {
      name,
      customer,
      templateId,
      answers: JSON.stringify(answersObj),
      startDate: start,
      pmHours,
      createdBy,
      projectId: targetProjectId,
      version,
    },
  });

  await rebuildStages(calculation.id, primary, start, scheduleConfigFromTemplate(template));

  const defaultRisks = risksFromTemplate(template.riskTemplates);
  if (defaultRisks.length > 0) {
    await prisma.risk.createMany({
      data: defaultRisks.map((r) => ({ ...r, calculationId: calculation.id })),
    });
  }

  await writeAudit({
    actorType: actorTypeFromAccess(access.kind),
    actorId: access.actorId,
    action: 'calculation.create',
    entityType: 'calculation',
    entityId: calculation.id,
    meta: { templateId, name, customer },
    ip: clientIp(req),
  });

  // Presale (share/anonymous) gets a bound token so subsequent PUT/export work
  // without re-opening the global data-plane.
  const shareToken =
    access.kind === 'staff'
      ? undefined
      : createShareToken({
          calculationId: calculation.id,
          templateId,
          scopes: ['read', 'write', 'export'],
        });

  return NextResponse.json(
    { id: calculation.id, ...(shareToken ? { shareToken } : {}) },
    { status: 201 },
  );
}
