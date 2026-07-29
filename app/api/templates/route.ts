import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const templates = await prisma.formTemplate.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { fields: true, stageTemplates: true, calculations: true } } },
  });
  return NextResponse.json(templates);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.name || typeof body.name !== "string") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const template = await prisma.formTemplate.create({
    data: { name: body.name, description: body.description ?? null },
  });
  return NextResponse.json(template, { status: 201 });
}
