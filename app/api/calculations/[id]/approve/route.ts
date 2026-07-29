import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";

// Architect signs off on the presale calculation.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiRole("architect");
  if (auth instanceof NextResponse) return auth;

  const calculation = await prisma.calculation.update({
    where: { id: params.id },
    data: { status: "approved" },
  });
  return NextResponse.json(calculation);
}
