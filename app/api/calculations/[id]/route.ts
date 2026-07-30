import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { primaryStagesFromTemplate, rebuildStages, pmHoursFor, scheduleConfigFromTemplate } from "@/lib/calc";
import { requireApiRole } from "@/lib/auth";

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const calculation = await prisma.calculation.findUnique({
    where: { id: params.id },
    include: {
      template: { include: { fields: { orderBy: { order: "asc" } }, stageTemplates: { orderBy: { order: "asc" } } } },
      stages: { orderBy: { order: "asc" } },
      risks: { orderBy: { order: "asc" } },
    },
  });
  if (!calculation) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ...calculation, answers: JSON.parse(calculation.answers) });
}

// Presale edits: name/customer/answers -> stages (and the derived РП hours) are regenerated
// from the template formulas. Per-stage requirements text is architect-only, so it's untouched here.
export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const body = await req.json();
  const existing = await prisma.calculation.findUnique({
    where: { id: params.id },
    include: { template: { include: { stageTemplates: true, fields: true } } },
  });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (existing.status === "approved") {
    return NextResponse.json({ error: "Расчёт уже утверждён и не может быть изменён" }, { status: 409 });
  }

  const answers = body.answers ?? JSON.parse(existing.answers);

  // A template default locks the start date for presale — the submitted value is ignored.
  const startDate =
    existing.template.defaultStartDate ?? (body.startDate ? new Date(body.startDate) : existing.startDate);

  const primary = primaryStagesFromTemplate(existing.template.stageTemplates, answers);
  const pmHours = pmHoursFor(existing.template.fields, answers, primary);

  const calculation = await prisma.calculation.update({
    where: { id: params.id },
    data: {
      name: body.name ?? existing.name,
      customer: body.customer ?? existing.customer,
      answers: JSON.stringify(answers),
      startDate,
      pmHours,
      status: existing.status === "pending_approval" ? "draft" : existing.status,
    },
  });

  await rebuildStages(calculation.id, primary, startDate, scheduleConfigFromTemplate(existing.template));

  return NextResponse.json({ ok: true });
}

// Architect/admin override: bypasses the template-level lock on startDate
// (but not the global "already approved" lock). Rescheduling preserves every stage's
// current hours and per-stage requirements — it only shifts dates, it never re-runs formulas.
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiRole("architect");
  if (auth instanceof NextResponse) return auth;

  const body = await req.json();
  const existing = await prisma.calculation.findUnique({
    where: { id: params.id },
    include: {
      stages: { orderBy: { order: "asc" } },
      template: { select: { workDayHours: true, includeWeekends: true } },
    },
  });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (existing.status === "approved") {
    return NextResponse.json({ error: "Расчёт уже утверждён и не может быть изменён" }, { status: 409 });
  }
  if (!body.startDate) {
    return NextResponse.json({ error: "startDate is required" }, { status: 400 });
  }

  const startDate = new Date(body.startDate);
  await prisma.calculation.update({ where: { id: params.id }, data: { startDate } });

  const primary = existing.stages
    .filter((s) => !s.isApprovalTask)
    .map((s) => ({
      name: s.name,
      role: s.role,
      hours: s.hours,
      requirements: s.requirements,
      parallel: s.parallel,
      approvalDays: s.approvalDays,
    }));
  await rebuildStages(params.id, primary, startDate, scheduleConfigFromTemplate(existing.template));

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiRole("architect");
  if (auth instanceof NextResponse) return auth;

  await prisma.calculation.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
