import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Presale sends the calculation to the architect for review.
export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const calculation = await prisma.calculation.update({
    where: { id: params.id },
    data: { status: 'pending_approval' },
  });
  return NextResponse.json(calculation);
}
