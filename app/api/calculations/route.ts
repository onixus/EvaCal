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

// Old calculations are visible to everyone, so a plain list with no auth filtering.
// Paged: the body stays a plain array, and the X-Total-Count / X-Page headers tell a
// caller there is more to fetch, so the cap is never silent.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = parseLimit(searchParams.get('limit'));
  const page = parsePage(searchParams.get('page') ?? undefined);

  const [total, calculations] = await Promise.all([
    prisma.calculation.count(),
    prisma.calculation.findMany({
      ...pageArgs(page, limit),
      orderBy: { createdAt: 'desc' },
      include: {
        template: { select: { name: true } },
        // Only the fields the summary below actually reads — pulling whole Stage rows
        // here drags every stage's `requirements` text into the list response.
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

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, customer, templateId, answers, startDate } = body;
  if (!name || !customer || !templateId) {
    return NextResponse.json(
      { error: 'name, customer and templateId are required' },
      { status: 400 },
    );
  }

  const template = await prisma.formTemplate.findUnique({
    where: { id: templateId },
    include: { stageTemplates: true, fields: true, riskTemplates: true },
  });
  if (!template) return NextResponse.json({ error: 'template not found' }, { status: 404 });

  // A template-level default locks the start date for presale; otherwise the submitted value is used.
  const start = template.defaultStartDate ?? (startDate ? new Date(startDate) : new Date());
  const answersObj = answers ?? {};

  const primary = primaryStagesFromTemplate(template.stageTemplates, answersObj);
  const pmHours = pmHoursFor(template.fields, answersObj, primary);

  const calculation = await prisma.calculation.create({
    data: {
      name,
      customer,
      templateId,
      answers: JSON.stringify(answersObj),
      startDate: start,
      pmHours,
      createdBy: 'presale',
    },
  });

  await rebuildStages(calculation.id, primary, start, scheduleConfigFromTemplate(template));

  const defaultRisks = risksFromTemplate(template.riskTemplates);
  if (defaultRisks.length > 0) {
    await prisma.risk.createMany({
      data: defaultRisks.map((r) => ({ ...r, calculationId: calculation.id })),
    });
  }

  return NextResponse.json({ id: calculation.id }, { status: 201 });
}
