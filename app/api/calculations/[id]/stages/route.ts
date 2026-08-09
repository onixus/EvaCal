import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  rebuildStages,
  pmHoursFor,
  scheduleConfigFromTemplate,
} from "@/lib/calc";
import { requireApiRole } from "@/lib/auth";

// Architect editing: replaces the full ordered list of primary (non-approval) stages,
// including each stage's own "Требования и ограничения" text, parallel flag, and
// custom approval-task duration. Approval tasks for consultant/developer/engineer/analyst
// stages are re-derived automatically.
export async function PUT(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const params = await props.params;
  const auth = await requireApiRole("architect");
  if (auth instanceof NextResponse) return auth;

  const body = await req.json();
  const stages = body.stages;
  if (!Array.isArray(stages) || stages.length === 0) {
    return NextResponse.json(
      { error: "stages array is required" },
      { status: 400 },
    );
  }
  for (const s of stages) {
    if (!s.name || !s.role || typeof s.hours !== "number" || s.hours < 0) {
      return NextResponse.json(
        { error: "each stage needs name, role and non-negative hours" },
        { status: 400 },
      );
    }
  }

  const existing = await prisma.calculation.findUnique({
    where: { id: params.id },
    include: {
      template: {
        select: { fields: true, workDayHours: true, includeWeekends: true },
      },
    },
  });
  if (!existing)
    return NextResponse.json({ error: "not found" }, { status: 404 });
  if (existing.status === "approved") {
    return NextResponse.json(
      { error: "Расчёт уже утверждён и не может быть изменён" },
      { status: 409 },
    );
  }

  const primary = stages.map(
    (s: {
      name: string;
      role: string;
      hours: number;
      requirements?: string | null;
      parallel?: boolean;
      approvalDays?: number | null;
    }) => ({
      name: s.name,
      role: s.role,
      hours: s.hours,
      requirements: s.requirements || null,
      parallel: !!s.parallel,
      approvalDays:
        s.approvalDays && s.approvalDays > 0
          ? Math.round(s.approvalDays)
          : null,
    }),
  );

  const pmHours = pmHoursFor(
    existing.template.fields,
    JSON.parse(existing.answers),
    primary,
  );
  await prisma.calculation.update({
    where: { id: params.id },
    data: { pmHours },
  });

  const result = await rebuildStages(
    params.id,
    primary,
    existing.startDate,
    scheduleConfigFromTemplate(existing.template),
  );
  return NextResponse.json(result);
}
