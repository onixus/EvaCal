import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiRole } from '@/lib/auth';
import { pageArgs, paginationHeaders, parseLimit, parsePage } from '@/lib/pagination';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = parseLimit(searchParams.get('limit'));
  const page = parsePage(searchParams.get('page') ?? undefined);

  const [total, templates] = await Promise.all([
    prisma.formTemplate.count(),
    prisma.formTemplate.findMany({
      ...pageArgs(page, limit),
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { fields: true, stageTemplates: true, calculations: true },
        },
      },
    }),
  ]);
  return NextResponse.json(templates, { headers: paginationHeaders(total, page, limit) });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('admin');
  if (auth instanceof NextResponse) return auth;

  const body = await req.json();
  if (!body.name || typeof body.name !== 'string') {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  const template = await prisma.formTemplate.create({
    data: { name: body.name, description: body.description ?? null },
  });
  return NextResponse.json(template, { status: 201 });
}
