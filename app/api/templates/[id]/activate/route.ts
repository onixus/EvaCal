import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  await prisma.$transaction([
    prisma.formTemplate.updateMany({ data: { isActive: false }, where: { isActive: true } }),
    prisma.formTemplate.update({ where: { id: params.id }, data: { isActive: true } }),
  ]);
  return NextResponse.json({ ok: true });
}
