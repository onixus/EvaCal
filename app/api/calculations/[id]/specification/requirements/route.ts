import { NextRequest, NextResponse } from 'next/server';
import { requireCalcAccess } from '@/lib/access';
import { handleApiError } from '@/lib/apiHelpers';
import { loadRequirementOptions } from '@/lib/specification/requirementStore';

export const dynamic = 'force-dynamic';
type Params = { params: Promise<{ id: string }> };

/**
 * #101 этап 3: требования комплекта ГОСТ 34 (черновик студии или последний комплект),
 * которые можно указать обоснованием позиции спецификации. Только чтение.
 */
export async function GET(req: NextRequest, props: Params) {
  try {
    const { id } = await props.params;
    const access = await requireCalcAccess(req, id, ['read']);
    if (access instanceof NextResponse) return access;
    return NextResponse.json(await loadRequirementOptions(id), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return handleApiError(error, 'Не удалось загрузить требования', 500);
  }
}
