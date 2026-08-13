import { NextRequest, NextResponse } from 'next/server';
import {
  loadCalculationForExport,
  safeFileName,
  contentDisposition,
  responseBody,
} from '@/lib/export';
import { renderCalculationXlsx } from '@/lib/xlsx';
import { requireCalcAccess } from '@/lib/access';
import { actorTypeFromAccess, clientIp, writeAudit } from '@/lib/audit';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const access = await requireCalcAccess(req, params.id, ['export']);
  if (access instanceof NextResponse) return access;

  const calc = await loadCalculationForExport(params.id);
  if (!calc) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const buffer = renderCalculationXlsx(calc);

  await writeAudit({
    actorType: actorTypeFromAccess(access.kind),
    actorId: access.actorId,
    action: 'calculation.export.xlsx',
    entityType: 'calculation',
    entityId: params.id,
    ip: clientIp(req),
  });

  return new NextResponse(responseBody(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': contentDisposition(safeFileName(calc.name), 'xlsx'),
      'Content-Length': String(buffer.length),
    },
  });
}
