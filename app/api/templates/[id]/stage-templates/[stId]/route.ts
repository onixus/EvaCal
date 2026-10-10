import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiRole } from '@/lib/auth';
import { lockTemplate } from '@/lib/normProposalsData';
import { invalidNormHours } from '@/lib/stageTemplateValidation';

export async function PUT(
  req: NextRequest,
  props: { params: Promise<{ id: string; stId: string }> },
) {
  const params = await props.params;
  const auth = await requireApiRole('admin');
  if (auth instanceof NextResponse) return auth;

  const body = await req.json();
  const invalid = invalidNormHours(body);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  // Та же блокировка, что у предложений нормативов (#103 WP-6c): правка этапа
  // не проскакивает между проверкой снимка и утверждением предложения.
  const stageTemplate = await prisma.$transaction(async (tx) => {
    await lockTemplate(tx, params.id);
    const existing = await tx.stageTemplate.findFirst({
      where: { id: params.stId, templateId: params.id },
      select: { id: true },
    });
    if (!existing) return null;
    return tx.stageTemplate.update({
      where: { id: params.stId },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.role !== undefined ? { role: body.role } : {}),
        ...(body.baseHours !== undefined ? { baseHours: body.baseHours } : {}),
        ...(body.hoursPerUnit !== undefined ? { hoursPerUnit: body.hoursPerUnit } : {}),
        ...(body.driverFieldKey !== undefined
          ? { driverFieldKey: body.driverFieldKey || null }
          : {}),
        ...(body.requirements !== undefined ? { requirements: body.requirements || null } : {}),
        ...(body.order !== undefined ? { order: body.order } : {}),
      },
    });
  });
  if (!stageTemplate) return NextResponse.json({ error: 'Этап не найден' }, { status: 404 });
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
