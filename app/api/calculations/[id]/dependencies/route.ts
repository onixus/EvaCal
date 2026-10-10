import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiRole } from '@/lib/auth';
import { clientIp, writeAudit } from '@/lib/audit';
import { handleApiError } from '@/lib/apiHelpers';
import { DependencyError, parseDependencyInput, replaceDependencies } from '@/lib/planningData';

export const dynamic = 'force-dynamic';

/** Явные зависимости этапов расчёта (#103 WP-5e). */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiRole(['architect', 'gap', 'techwriter', 'reviewer', 'admin']);
  if (auth instanceof NextResponse) return auth;
  const dependencies = await prisma.stageDependency.findMany({
    where: { calculationId: params.id },
    select: { id: true, fromStageId: true, toStageId: true, type: true, lagDays: true },
    orderBy: { createdAt: 'asc' },
  });
  return NextResponse.json({ dependencies });
}

/**
 * Заменить набор зависимостей целиком и перестроить даты этапов на месте (id
 * этапов и факт сохраняются). Петли, дубли, чужие этапы и циклы — отказ до
 * записи. Утверждённый расчёт не меняется, как и его этапы.
 */
export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiRole(['architect', 'admin']);
  if (auth instanceof NextResponse) return auth;
  try {
    const calc = await prisma.calculation.findUnique({
      where: { id: params.id },
      select: { id: true, status: true },
    });
    if (!calc) return NextResponse.json({ error: 'not found' }, { status: 404 });
    if (calc.status === 'approved') {
      return NextResponse.json(
        { error: 'Расчёт уже утверждён и не может быть изменён' },
        { status: 409 },
      );
    }
    const body = await req.json().catch(() => ({}));
    const input = parseDependencyInput(body.dependencies);
    const dependencies = await replaceDependencies(calc.id, input);
    await writeAudit({
      actorType: 'user',
      actorId: auth.userId,
      action: 'calculation.dependencies',
      entityType: 'calculation',
      entityId: calc.id,
      meta: { count: dependencies.length },
      ip: clientIp(req),
    });
    return NextResponse.json({ dependencies });
  } catch (err) {
    if (err instanceof DependencyError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return handleApiError(err, 'Failed to save dependencies');
  }
}
