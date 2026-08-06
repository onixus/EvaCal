import { NextRequest, NextResponse } from 'next/server';
import { generateGost34Document } from '@/lib/gost34';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { calculation, metadataOverride, rawRequirements } = body;

    const { buffer, filename } = await generateGost34Document({
      calculation,
      metadataOverride,
      rawRequirements,
    });

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(buffer.length),
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 });
  }
}
