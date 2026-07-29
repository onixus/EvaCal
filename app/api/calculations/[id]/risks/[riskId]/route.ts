import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";

async function assertEditable(calculationId: string) {
  const calculation = await prisma.calculation.findUnique({ where: { id: calculationId } });
  if (!calculation) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (calculation.status === "approved") {
    return NextResponse.json({ error: "Расчёт уже утверждён и не может быть изменён" }, { status: 409 });
  }
  return null;
}

export async function PUT(req: NextRequest, { params }: { params: { id: string; riskId: string } }) {
  const auth = await requireApiRole("architect");
  if (auth instanceof NextResponse) return auth;

  const blocked = await assertEditable(params.id);
  if (blocked) return blocked;

  const body = await req.json();
  const risk = await prisma.risk.update({
    where: { id: params.riskId },
    data: {
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.hours !== undefined ? { hours: Number(body.hours) || 0 } : {}),
    },
  });
  return NextResponse.json(risk);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; riskId: string } }) {
  const auth = await requireApiRole("architect");
  if (auth instanceof NextResponse) return auth;

  const blocked = await assertEditable(params.id);
  if (blocked) return blocked;

  await prisma.risk.delete({ where: { id: params.riskId } });
  return NextResponse.json({ ok: true });
}
