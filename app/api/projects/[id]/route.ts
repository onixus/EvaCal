import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireStaff } from '@/lib/access';
import { clientIp, writeAudit } from '@/lib/audit';
import { getProjectDetails } from '@/lib/project';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (staff instanceof NextResponse) return staff;

  const params = await props.params;
  const project = await getProjectDetails(params.id);

  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  return NextResponse.json(project);
}

export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (staff instanceof NextResponse) return staff;

  const params = await props.params;
  const body = await req.json().catch(() => ({}));
  const { name, customer, code, description, status } = body;

  const existing = await prisma.project.findUnique({
    where: { id: params.id },
  });

  if (!existing) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const updated = await prisma.project.update({
    where: { id: params.id },
    data: {
      name: name?.trim() || existing.name,
      customer: customer?.trim() || existing.customer,
      code: code !== undefined ? code?.trim() || null : existing.code,
      description: description !== undefined ? description?.trim() || null : existing.description,
      status: status || existing.status,
    },
  });

  await writeAudit({
    actorType: 'user',
    actorId: staff.userId,
    action: 'project.update',
    entityType: 'project',
    entityId: updated.id,
    meta: { changes: body },
    ip: clientIp(req),
  });

  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (staff instanceof NextResponse) return staff;
  if (staff.role !== 'admin') {
    return NextResponse.json({ error: 'Требуются права администратора' }, { status: 403 });
  }

  const params = await props.params;
  const existing = await prisma.project.findUnique({
    where: { id: params.id },
  });

  if (!existing) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  await prisma.project.delete({
    where: { id: params.id },
  });

  await writeAudit({
    actorType: 'user',
    actorId: staff.userId,
    action: 'project.delete',
    entityType: 'project',
    entityId: params.id,
    meta: { name: existing.name, customer: existing.customer },
    ip: clientIp(req),
  });

  return NextResponse.json({ ok: true });
}
