import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { primaryStagesFromTemplate, rebuildStages, withPmStages } from "@/lib/calc";
import { requireApiRole } from "@/lib/auth";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const calculation = await prisma.calculation.findUnique({
    where: { id: params.id },
    include: {
      template: { include: { fields: { orderBy: { order: "asc" } }, stageTemplates: { orderBy: { order: "asc" } } } },
      stages: { orderBy: { order: "asc" } },
    },
  });
  if (!calculation) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ...calculation, answers: JSON.parse(calculation.answers) });
}

// Presale edits: name/customer/answers -> stages are regenerated from the template formulas.
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
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

  // A template default locks the field for presale — the submitted value is ignored.
  const startDate =
    existing.template.defaultStartDate ?? (body.startDate ? new Date(body.startDate) : existing.startDate);
  const requirements =
    existing.template.defaultRequirements ??
    (body.requirements !== undefined ? body.requirements || null : existing.requirements);

  const calculation = await prisma.calculation.update({
    where: { id: params.id },
    data: {
      name: body.name ?? existing.name,
      customer: body.customer ?? existing.customer,
      answers: JSON.stringify(answers),
      startDate,
      requirements,
      status: existing.status === "pending_approval" ? "draft" : existing.status,
    },
  });

  const primary = withPmStages(
    existing.template.fields,
    answers,
    primaryStagesFromTemplate(existing.template.stageTemplates, answers)
  );
  await rebuildStages(calculation.id, primary, startDate);

  return NextResponse.json({ ok: true });
}

// Architect/admin override: bypasses the template-level lock on startDate/requirements
// (but not the global "already approved" lock). Rescheduling preserves every stage's
// current hours — it only shifts dates from the new anchor, it never re-runs formulas.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiRole("architect");
  if (auth instanceof NextResponse) return auth;

  const body = await req.json();
  const existing = await prisma.calculation.findUnique({
    where: { id: params.id },
    include: { stages: { orderBy: { order: "asc" } } },
  });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (existing.status === "approved") {
    return NextResponse.json({ error: "Расчёт уже утверждён и не может быть изменён" }, { status: 409 });
  }

  const startDate = body.startDate ? new Date(body.startDate) : existing.startDate;
  const requirements = body.requirements !== undefined ? body.requirements || null : existing.requirements;

  await prisma.calculation.update({ where: { id: params.id }, data: { startDate, requirements } });

  if (body.startDate) {
    const primary = existing.stages
      .filter((s) => !s.isApprovalTask)
      .map((s) => ({ name: s.name, role: s.role, hours: s.hours }));
    await rebuildStages(params.id, primary, startDate);
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiRole("architect");
  if (auth instanceof NextResponse) return auth;

  await prisma.calculation.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
