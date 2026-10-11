import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHelpers';
import { OfferCompareError, loadOfferComparison, parseCompareIds } from '@/lib/offerCompareData';

/**
 * Сравнение вариантов КП проекта (#103 4.4): `?ids=a,b[,c…]`, первая версия —
 * база для разниц. Только чтение: цифры считаются по сохранённым условиям
 * каждой версии. Доступ — ролям, которые видят коммерческие итоги проекта.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(['presale', 'architect', 'reviewer', 'admin']);
  if (auth instanceof NextResponse) return auth;
  const { id } = await props.params;
  try {
    const ids = parseCompareIds(new URL(req.url).searchParams.get('ids'));
    return NextResponse.json(await loadOfferComparison(id, ids));
  } catch (error) {
    if (error instanceof OfferCompareError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return handleApiError(error, 'Failed to compare offers', 500);
  }
}
