import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";

export async function PUT(
  req: NextRequest,
  props: { params: Promise<{ id: string; fieldId: string }> },
) {
  const params = await props.params;
  const auth = await requireApiRole("admin");
  if (auth instanceof NextResponse) return auth;

  const body = await req.json();
  const field = await prisma.formField.update({
    where: { id: params.fieldId },
    data: {
      ...(body.label !== undefined ? { label: body.label } : {}),
      ...(body.key !== undefined ? { key: body.key } : {}),
      ...(body.type !== undefined ? { type: body.type } : {}),
      ...(body.options !== undefined
        ? { options: body.options ? JSON.stringify(body.options) : null }
        : {}),
      ...(body.required !== undefined ? { required: !!body.required } : {}),
      ...(body.order !== undefined ? { order: body.order } : {}),
    },
  });
  return NextResponse.json(field);
}

export async function DELETE(
  _req: NextRequest,
  props: { params: Promise<{ id: string; fieldId: string }> },
) {
  const params = await props.params;
  const auth = await requireApiRole("admin");
  if (auth instanceof NextResponse) return auth;

  await prisma.formField.delete({ where: { id: params.fieldId } });
  return NextResponse.json({ ok: true });
}
