import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";

export async function PUT(
  req: NextRequest,
  props: { params: Promise<{ id: string; rtId: string }> },
) {
  const params = await props.params;
  const auth = await requireApiRole("admin");
  if (auth instanceof NextResponse) return auth;

  const body = await req.json();
  const riskTemplate = await prisma.riskTemplate.update({
    where: { id: params.rtId },
    data: {
      ...(body.description !== undefined
        ? { description: body.description }
        : {}),
      ...(body.hours !== undefined ? { hours: Number(body.hours) || 0 } : {}),
      ...(body.order !== undefined ? { order: body.order } : {}),
    },
  });
  return NextResponse.json(riskTemplate);
}

export async function DELETE(
  _req: NextRequest,
  props: { params: Promise<{ id: string; rtId: string }> },
) {
  const params = await props.params;
  const auth = await requireApiRole("admin");
  if (auth instanceof NextResponse) return auth;

  await prisma.riskTemplate.delete({ where: { id: params.rtId } });
  return NextResponse.json({ ok: true });
}
