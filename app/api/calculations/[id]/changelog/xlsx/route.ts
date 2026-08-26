import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireCalcAccess } from '@/lib/access';
import { contentDisposition, responseBody, safeFileName } from '@/lib/export';
import { renderInternalChangesXlsx } from '@/lib/xlsx';
import { listInternalChanges } from '@/lib/changelog';
import { actorTypeFromAccess, clientIp, writeAudit } from '@/lib/audit';
import { handleApiError } from '@/lib/apiHelpers';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const params = await props.params;
    const access = await requireCalcAccess(req, params.id, ['export']);
    if (access instanceof NextResponse) return access;

    const calc = await prisma.calculation.findUnique({
      where: { id: params.id },
      select: { name: true },
    });
    if (!calc) return NextResponse.json({ error: 'Расчёт не найден' }, { status: 404 });

    // Выгрузка читается сверху вниз как документ, поэтому порядок обратный
    // экранному: самая ранняя правка первой.
    const rows = (await listInternalChanges(params.id)).slice().reverse();
    const buffer = renderInternalChangesXlsx(calc.name, rows);

    await writeAudit({
      actorType: actorTypeFromAccess(access.kind),
      actorId: access.actorId,
      action: 'calculation.export.changelog',
      entityType: 'calculation',
      entityId: params.id,
      ip: clientIp(req),
    });

    return new NextResponse(responseBody(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': contentDisposition(
          safeFileName(`Лист_изменений_${calc.name}`),
          'xlsx',
        ),
        'Content-Length': String(buffer.length),
      },
    });
  } catch (err) {
    return handleApiError(err, 'Failed to export internal changes', 500);
  }
}
