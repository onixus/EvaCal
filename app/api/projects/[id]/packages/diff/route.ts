import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireStaff, isAnonymousPresaleAllowed } from '@/lib/access';
import { computePackageDiff } from '@/lib/gost34/diff';
import { handleApiError } from '@/lib/apiHelpers';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const params = await props.params;
    const project = await prisma.project.findUnique({
      where: { id: params.id },
    });

    if (!project) {
      return NextResponse.json({ error: 'Проект не найден' }, { status: 404 });
    }

    if (!isAnonymousPresaleAllowed()) {
      const staffAuth = await requireStaff();
      if (staffAuth instanceof NextResponse) return staffAuth;
    }

    const { searchParams } = new URL(req.url);
    const fromId = searchParams.get('from')?.trim();
    const toId = searchParams.get('to')?.trim();

    if (!fromId || !toId) {
      return NextResponse.json({ error: 'Параметры from и to обязательны' }, { status: 400 });
    }

    const [fromPkg, toPkg] = await Promise.all([
      prisma.gostPackage.findUnique({ where: { id: fromId } }),
      prisma.gostPackage.findUnique({ where: { id: toId } }),
    ]);

    if (!fromPkg || !toPkg) {
      return NextResponse.json({ error: 'Один или оба пакета не найдены' }, { status: 404 });
    }

    if (fromPkg.projectId !== project.id || toPkg.projectId !== project.id) {
      return NextResponse.json({ error: 'Пакеты принадлежат другому проекту' }, { status: 400 });
    }

    const diff = computePackageDiff(fromPkg, toPkg);

    return NextResponse.json({ diff });
  } catch (err) {
    return handleApiError(err, 'Failed to compute package diff', 500);
  }
}
