import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { primaryStagesFromTemplate, rebuildStages } from "@/lib/calc";
import { totalLaborHours } from "@/lib/scheduling";

// Old calculations are visible to everyone, so a plain list with no auth filtering.
export async function GET() {
  const calculations = await prisma.calculation.findMany({
    orderBy: { createdAt: "desc" },
    include: { template: { select: { name: true } }, stages: true },
  });
  const summarized = calculations.map((c) => ({
    id: c.id,
    name: c.name,
    customer: c.customer,
    status: c.status,
    templateName: c.template.name,
    totalHours: totalLaborHours(c.stages),
    stageCount: c.stages.filter((s) => !s.isApprovalTask).length,
    startDate: c.startDate,
    endDate: c.stages.reduce<Date | null>((latest, s) => {
      const end = new Date(s.endDate);
      return !latest || end > latest ? end : latest;
    }, null),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }));
  return NextResponse.json(summarized);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, customer, templateId, answers, startDate } = body;
  if (!name || !customer || !templateId) {
    return NextResponse.json({ error: "name, customer and templateId are required" }, { status: 400 });
  }

  const template = await prisma.formTemplate.findUnique({
    where: { id: templateId },
    include: { stageTemplates: true },
  });
  if (!template) return NextResponse.json({ error: "template not found" }, { status: 404 });

  const start = startDate ? new Date(startDate) : new Date();
  const answersObj = answers ?? {};

  const calculation = await prisma.calculation.create({
    data: {
      name,
      customer,
      templateId,
      answers: JSON.stringify(answersObj),
      startDate: start,
      createdBy: "presale",
    },
  });

  const primary = primaryStagesFromTemplate(template.stageTemplates, answersObj);
  await rebuildStages(calculation.id, primary, start);

  return NextResponse.json({ id: calculation.id }, { status: 201 });
}
