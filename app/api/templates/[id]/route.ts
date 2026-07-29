import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const template = await prisma.formTemplate.findUnique({
    where: { id: params.id },
    include: {
      fields: { orderBy: { order: "asc" } },
      stageTemplates: { orderBy: { order: "asc" } },
    },
  });
  if (!template) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(template);
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiRole("admin");
  if (auth instanceof NextResponse) return auth;

  const body = await req.json();
  const template = await prisma.formTemplate.update({
    where: { id: params.id },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
    },
  });
  return NextResponse.json(template);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiRole("admin");
  if (auth instanceof NextResponse) return auth;

  const inUse = await prisma.calculation.count({ where: { templateId: params.id } });
  if (inUse > 0) {
    return NextResponse.json(
      { error: "Шаблон используется в расчётах и не может быть удалён" },
      { status: 409 }
    );
  }
  await prisma.formTemplate.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
