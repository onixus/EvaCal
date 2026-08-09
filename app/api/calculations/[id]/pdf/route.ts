import { NextRequest, NextResponse } from 'next/server';
import { loadCalculationForExport, safeFileName, contentDisposition } from '@/lib/export';
import { renderCalculationPdf } from '@/lib/pdf';

// Same visibility as the rest of the archive: no auth required to export a calculation.
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': contentDisposition(safeFileName(calc.name), 'pdf'),
      'Content-Length': String(buffer.length),
    },
  });
}
