import { NextRequest, NextResponse } from 'next/server';
import { requireCalcAccess } from '@/lib/access';
import { CATALOG_ROLES } from '@/lib/catalog/types';
import { proposeSizingCandidates } from '@/lib/sizing/service';
import { sizingError } from '@/lib/sizing/http';

export const dynamic = 'force-dynamic';
type Params = { params: Promise<{ id: string }> };

/**
 * #101 §5: кандидаты каталога для метрики прогона ({ runId, metric, scenario? }).
 * Ничего не сохраняет. Каталог и его цены доступны только сотрудникам с доступом
 * к каталогу; выбранный кандидат сохраняется обычным сохранением спецификации.
 */
export async function POST(req: NextRequest, props: Params) {
  try {
    const { id } = await props.params;
    const access = await requireCalcAccess(req, id, ['read']);
    if (access instanceof NextResponse) return access;
    if (!(access.kind === 'staff' && CATALOG_ROLES.includes(access.session?.role || '')))
      return NextResponse.json(
        { error: 'Подбор из каталога доступен сотрудникам с доступом к каталогу' },
        { status: 403, headers: { 'Cache-Control': 'private, no-store' } },
      );
    const proposal = await proposeSizingCandidates(id, await req.json());
    return NextResponse.json(proposal, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return sizingError(error, 'Не удалось подобрать позиции каталога');
  }
}
