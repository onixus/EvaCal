import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHelpers';
import { MAX_WEEKS, type CapacityQuery } from '@/lib/capacityData';
import { parseVariants, type PlanVariant } from '@/lib/planning';
import { loadVariantComparison } from '@/lib/planningData';

export const dynamic = 'force-dynamic';

/**
 * What-if поверх ресурсного плана; в базу ничего не пишется.
 *
 * - `{ variants: [{ id, label, changes: [...] }] }` — сравнение вариантов
 *   (#103 WP-5e): перенос старта (`shift`), подрядчик (`contractor`),
 *   изменение команды (`team`). Ответ — базовый план и сводка по каждому
 *   варианту (конец расчётов, недели перегруза, разница стоимости, матрица).
 * - `{ shifts: [{ calculationId, shiftDays }] }` — прежний формат: матрица
 *   с переносами. Гант перестраивается по календарю и зависимостям — так же,
 *   как его затем запишет `/api/capacity/apply`.
 *
 * Применение — только через `/api/capacity/apply` (переносы старта).
 */
export async function POST(req: NextRequest) {
  const auth = await requireApiRole(['architect', 'admin']);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json().catch(() => ({}));
    const from = body.from ? new Date(body.from) : undefined;
    const weeks = Number(body.weeks);
    const query: CapacityQuery = {
      from: from && !Number.isNaN(from.getTime()) ? from : undefined,
      weeks: Number.isFinite(weeks) && weeks > 0 ? Math.min(MAX_WEEKS, weeks) : undefined,
      includeDrafts: Boolean(body.drafts),
      roles: Array.isArray(body.roles) ? body.roles.map(String) : undefined,
    };

    if (body.variants !== undefined) {
      let variants: PlanVariant[];
      try {
        variants = parseVariants(body.variants);
      } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 400 });
      }
      return NextResponse.json(await loadVariantComparison(query, variants));
    }

    const shifts = Array.isArray(body.shifts)
      ? body.shifts
          .map((s: { calculationId?: unknown; shiftDays?: unknown }) => ({
            type: 'shift' as const,
            calculationId: String(s.calculationId ?? ''),
            shiftDays: Math.round(Number(s.shiftDays) || 0),
          }))
          .filter(
            (s: { calculationId: string; shiftDays: number }) =>
              s.calculationId && Math.abs(s.shiftDays) <= 365,
          )
      : [];
    const comparison = await loadVariantComparison(
      query,
      shifts.length > 0 ? [{ id: 'shifts', label: 'Сдвиги', changes: shifts }] : [],
    );
    return NextResponse.json(
      shifts.length > 0 ? comparison.variants[0].matrix : comparison.baseline.matrix,
    );
  } catch (err) {
    return handleApiError(err, 'Failed to build what-if matrix');
  }
}
