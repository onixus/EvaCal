import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  if (!body.label || !body.key || !body.type) {
    return NextResponse.json({ error: "label, key and type are required" }, { status: 400 });
  }
  const count = await prisma.formField.count({ where: { templateId: params.id } });
  const field = await prisma.formField.create({
    data: {
      templateId: params.id,
      label: body.label,
      key: body.key,
      type: body.type,
      options: body.options ? JSON.stringify(body.options) : null,
      required: !!body.required,
      order: body.order ?? count,
    },
  });
  return NextResponse.json(field, { status: 201 });
}
