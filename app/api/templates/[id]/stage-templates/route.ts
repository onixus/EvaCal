import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  if (!body.name || !body.role) {
    return NextResponse.json({ error: "name and role are required" }, { status: 400 });
  }
  const count = await prisma.stageTemplate.count({ where: { templateId: params.id } });
  const stageTemplate = await prisma.stageTemplate.create({
    data: {
      templateId: params.id,
      name: body.name,
      role: body.role,
      baseHours: body.baseHours ?? 0,
      hoursPerUnit: body.hoursPerUnit ?? 0,
      driverFieldKey: body.driverFieldKey || null,
      order: body.order ?? count,
    },
  });
  return NextResponse.json(stageTemplate, { status: 201 });
}
