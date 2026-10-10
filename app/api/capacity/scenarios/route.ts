import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiRole } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHelpers';
import { MAX_WEEKS } from '@/lib/capacityData';
import { parseVariants, type PlanVariant } from '@/lib/planning';
import { loadVariantComparison } from '@/lib/planningData';

export const dynamic = 'force-dynamic';

/** Сохранённые сравнения вариантов (#103 WP-5e). Никогда не применяются сами. */
export async function GET() {
  const auth = await requireApiRole(['architect', 'gap', 'techwriter', 'reviewer', 'admin']);
  if (auth instanceof NextResponse) return auth;
  const scenarios = await prisma.planScenario.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      name: true,
      createdBy: true,
      createdAt: true,
      variants: true,
      result: true,
    },
  });
  return NextResponse.json({ scenarios });
}

/**
 * Сохранить сравнение: варианты пересчитываются на сервере, хранится сводка без
 * матриц (конец расчётов, недели перегруза, стоимость). Даты в плане не меняются.
 */
export async function POST(req: NextRequest) {
  const auth = await requireApiRole(['architect', 'admin']);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json().catch(() => ({}));
    const name = String(body.name ?? '').trim();
    if (!name || name.length > 200) {
      return NextResponse.json({ error: 'Название — от 1 до 200 символов' }, { status: 400 });
    }
    let variants: PlanVariant[];
    try {
      variants = parseVariants(body.variants);
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
    const weeks = Number(body.weeks);
    const comparison = await loadVariantComparison(
      {
        weeks: Number.isFinite(weeks) && weeks > 0 ? Math.min(MAX_WEEKS, weeks) : undefined,
        includeDrafts: Boolean(body.drafts),
      },
      variants,
    );
    const strip = ({ matrix: _matrix, ...rest }: (typeof comparison)['baseline']) => rest;
    const result = JSON.parse(
      JSON.stringify({
        baseline: strip(comparison.baseline),
        variants: comparison.variants.map(strip),
      }),
    );
    const scenario = await prisma.planScenario.create({
      data: {
        name,
        createdBy: auth.userId,
        variants: JSON.parse(JSON.stringify(variants)),
        result,
      },
      select: { id: true, name: true, createdAt: true },
    });
    return NextResponse.json(scenario, { status: 201 });
  } catch (err) {
    return handleApiError(err, 'Failed to save scenario');
  }
}
