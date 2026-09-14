import { NextRequest, NextResponse } from 'next/server';
import { requireCalcAccess } from '@/lib/access';
import { loadCalibration } from '@/lib/calibrationData';
import { handleApiError } from '@/lib/apiHelpers';

export const dynamic = 'force-dynamic';

/**
 * Калибровка оценки по похожим утверждённым проектам того же шаблона.
 *
 * Доступ — как к самому расчёту (staff, share-токен с read, анонимный режим).
 * Названия и заказчики соседей раскрываются только сотрудникам: гость по
 * ссылке видит обезличенные «Похожий проект №N» и только агрегаты.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const access = await requireCalcAccess(req, params.id, ['read']);
  if (access instanceof NextResponse) return access;

  try {
    const report = await loadCalibration(params.id, access.kind === 'staff');
    if (!report) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json(report);
  } catch (err) {
    return handleApiError(err, 'Не удалось построить калибровку');
  }
}
