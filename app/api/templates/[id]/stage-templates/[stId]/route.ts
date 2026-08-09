import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiRole } from '@/lib/auth';

export async function PUT(
  req: NextRequest,
  props: { params: Promise<{ id: string; stId: string }> },
) {
  const params = await props.params;
  const auth = await requireApiRole('admin');
  if (auth instanceof NextResponse) return auth;

  const body = await req.json();
  const stageTemplate = await prisma.stageTemplate.update({
    where: { id: params.stId },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.role !== undefined ? { role: body.role } : {}),
      ...(body.baseHours !== undefined ? { baseHours: body.baseHours } : {}),
      ...(body.hoursPerUnit !== undefined ? { hoursPerUnit: body.hoursPerUnit } : {}),
      ...(body.driverFieldKey !== undefined ? { driverFieldKey: body.driverFieldKey || null } : {}),
      ...(body.requirements !== undefined ? { requirements: body.requirements || null } : {}),
      ...(body.order !== undefined ? { order: body.order } : {}),
    },
  });
  return NextResponse.json(stageTemplate);
}

export async function DELETE(
  _req: NextRequest,
  props: { params: Promise<{ id: string; stId: string }> },
) {
  const params = await props.params;
  const auth = await requireApiRole('admin');
  if (auth instanceof NextResponse) return auth;

  await prisma.stageTemplate.delete({ where: { id: params.stId } });
  return NextResponse.json({ ok: true });
}
