import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Architect signs off on the presale calculation.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const calculation = await prisma.calculation.update({
    where: { id: params.id },
    data: { status: "approved" },
  });
  return NextResponse.json(calculation);
}
