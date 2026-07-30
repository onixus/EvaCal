import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";

// Deep-copies a template's fields, stage formulas and base risks into a new, inactive template
// so the admin can branch off an existing setup without disturbing calculations already made from it.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiRole("admin");
  if (auth instanceof NextResponse) return auth;

  const source = await prisma.formTemplate.findUnique({
    where: { id: params.id },
    include: { fields: true, stageTemplates: true, riskTemplates: true },
  });
  if (!source) return NextResponse.json({ error: "not found" }, { status: 404 });

  const copy = await prisma.formTemplate.create({
    data: {
      name: `${source.name} (копия)`,
      description: source.description,
      isActive: false,
      defaultStartDate: source.defaultStartDate,
      workDayHours: source.workDayHours,
      includeWeekends: source.includeWeekends,
      fields: {
        create: source.fields.map((f) => ({
          label: f.label,
          key: f.key,
          type: f.type,
          options: f.options,
          required: f.required,
          order: f.order,
        })),
      },
      stageTemplates: {
        create: source.stageTemplates.map((st) => ({
          name: st.name,
          role: st.role,
          baseHours: st.baseHours,
          hoursPerUnit: st.hoursPerUnit,
          driverFieldKey: st.driverFieldKey,
          requirements: st.requirements,
          order: st.order,
        })),
      },
      riskTemplates: {
        create: source.riskTemplates.map((rt) => ({
          description: rt.description,
          hours: rt.hours,
          order: rt.order,
        })),
      },
    },
  });

  return NextResponse.json(copy, { status: 201 });
}
