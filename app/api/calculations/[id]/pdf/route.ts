import { NextRequest, NextResponse } from 'next/server';
import {
  loadCalculationForExport,
  safeFileName,
  contentDisposition,
  responseBody,
} from '@/lib/export';
import { renderCalculationPdf } from '@/lib/pdf';
import { requireCalcAccess } from '@/lib/access';
import { actorTypeFromAccess, clientIp, writeAudit } from '@/lib/audit';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const access = await requireCalcAccess(req, params.id, ['export']);
  if (access instanceof NextResponse) return access;

  const calc = await loadCalculationForExport(params.id);
  if (!calc) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const doc = renderCalculationPdf(calc);

  const chunks: Buffer[] = [];
  const buffer = await new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });

  await writeAudit({
    actorType: actorTypeFromAccess(access.kind),
    actorId: access.actorId,
    action: 'calculation.export.pdf',
    entityType: 'calculation',
    entityId: params.id,
    ip: clientIp(req),
  });

  return new NextResponse(responseBody(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': contentDisposition(safeFileName(calc.name), 'pdf'),
      'Content-Length': String(buffer.length),
    },
  });
}
