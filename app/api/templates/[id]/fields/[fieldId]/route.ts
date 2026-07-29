import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PUT(req: NextRequest, { params }: { params: { id: string; fieldId: string } }) {
  const body = await req.json();
  const field = await prisma.formField.update({
    where: { id: params.fieldId },
    data: {
      ...(body.label !== undefined ? { label: body.label } : {}),
      ...(body.key !== undefined ? { key: body.key } : {}),
      ...(body.type !== undefined ? { type: body.type } : {}),
      ...(body.options !== undefined ? { options: body.options ? JSON.stringify(body.options) : null } : {}),
      ...(body.required !== undefined ? { required: !!body.required } : {}),
      ...(body.order !== undefined ? { order: body.order } : {}),
    },
  });
  return NextResponse.json(field);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; fieldId: string } }) {
  await prisma.formField.delete({ where: { id: params.fieldId } });
  return NextResponse.json({ ok: true });
}
