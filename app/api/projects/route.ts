import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireStaff } from '@/lib/access';
import { clientIp, writeAudit } from '@/lib/audit';
import { getOrCreateProject } from '@/lib/project';
import { pageArgs, paginationHeaders, parseLimit, parsePage } from '@/lib/pagination';

export async function GET(req: NextRequest) {
  const staff = await requireStaff();
  if (staff instanceof NextResponse) return staff;

  const { searchParams } = new URL(req.url);
  const limit = parseLimit(searchParams.get('limit'));
  const page = parsePage(searchParams.get('page') ?? undefined);
  const search = searchParams.get('search')?.trim();

  const where = search
    ? {
        OR: [
          { name: { contains: search } },
          { customer: { contains: search } },
          { code: { contains: search } },
        ],
      }
    : {};

  const [total, projects] = await Promise.all([
    prisma.project.count({ where }),
    prisma.project.findMany({
      where,
      ...pageArgs(page, limit),
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: {
          select: {
            calculations: true,
            packages: true,
          },
        },
        calculations: {
          take: 1,
          orderBy: { version: 'desc' },
          select: {
            id: true,
            version: true,
            status: true,
            updatedAt: true,
          },
        },
      },
    }),
  ]);

  return NextResponse.json(projects, { headers: paginationHeaders(total, page, limit) });
}

export async function POST(req: NextRequest) {
  const staff = await requireStaff();
  if (staff instanceof NextResponse) return staff;

  const body = await req.json().catch(() => ({}));
  const { name, customer, code, description, status } = body;

  if (!name?.trim() || !customer?.trim()) {
    return NextResponse.json(
      { error: 'name and customer are required' },
      { status: 400 },
    );
  }

  const project = await getOrCreateProject({
    name,
    customer,
    code,
    description,
    status,
    createdBy: staff.username,
  });

  await writeAudit({
    actorType: 'user',
    actorId: staff.userId,
    action: 'project.create',
    entityType: 'project',
    entityId: project.id,
    meta: { name: project.name, customer: project.customer },
    ip: clientIp(req),
  });

  return NextResponse.json(project, { status: 201 });
}
