import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiRole("admin");
  if (auth instanceof NextResponse) return auth;

  const body = await req.json();
  if (!body.description) {
    return NextResponse.json({ error: "description is required" }, { status: 400 });
  }
  const count = await prisma.riskTemplate.count({ where: { templateId: params.id } });
  const riskTemplate = await prisma.riskTemplate.create({
    data: {
      templateId: params.id,
      description: body.description,
      hours: Number(body.hours) || 0,
      order: body.order ?? count,
    },
  });
  return NextResponse.json(riskTemplate, { status: 201 });
}
