import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiRole } from '@/lib/auth';

// Risks are architect-only: they add contingency hours to the total without touching the Gantt.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiRole(['architect', 'admin']);
  if (auth instanceof NextResponse) return auth;

  const calculation = await prisma.calculation.findUnique({
    where: { id: params.id },
  });
  if (!calculation) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (calculation.status === 'approved') {
    return NextResponse.json(
      { error: 'Расчёт уже утверждён и не может быть изменён' },
      { status: 409 },
    );
  }

  const body = await req.json();
  if (!body.description) {
    return NextResponse.json({ error: 'description is required' }, { status: 400 });
  }

  const count = await prisma.risk.count({
    where: { calculationId: params.id },
  });
  const risk = await prisma.risk.create({
    data: {
      calculationId: params.id,
      description: body.description,
      hours: Number(body.hours) || 0,
      order: count,
    },
  });
  return NextResponse.json(risk, { status: 201 });
}
