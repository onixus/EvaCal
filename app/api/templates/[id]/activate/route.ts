import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";

export async function POST(
  _req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const params = await props.params;
  const auth = await requireApiRole("admin");
  if (auth instanceof NextResponse) return auth;

  await prisma.$transaction([
    prisma.formTemplate.updateMany({
      data: { isActive: false },
      where: { isActive: true },
    }),
    prisma.formTemplate.update({
      where: { id: params.id },
      data: { isActive: true },
    }),
  ]);
  return NextResponse.json({ ok: true });
}
