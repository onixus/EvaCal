import { gost34ErrorResponse } from '@/lib/gost34/generation/apiError';
import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { GOST34_LLM_ROLES } from '../roles';
import { generateGost34Document } from '@/lib/gost34';
import { responseBody, contentDisposition } from '@/lib/exportResponse';
import { handleApiError } from '@/lib/apiHelpers';

export async function POST(req: NextRequest) {
  const session = await requireApiRole(GOST34_LLM_ROLES);
  if (session instanceof NextResponse) return session;

  try {
    const body = await req.json();
    const {
      calculation,
      metadataOverride,
      rawRequirements,
      vendorFiles,
      projectContext,
      manualTraceLinks,
      sectionOverrides,
      tzAuthor,
    } = body;

    const { buffer, filename } = await generateGost34Document({
      calculation,
      metadataOverride,
      rawRequirements,
      vendorFiles,
      projectContext,
      manualTraceLinks,
      sectionOverrides,
      tzAuthor,
    });

    return new NextResponse(responseBody(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': contentDisposition(filename.replace(/\.docx$/, ''), 'docx'),
        'Content-Length': String(buffer.length),
      },
    });
  } catch (err: unknown) {
    return gost34ErrorResponse(err) || handleApiError(err, 'Failed to generate document', 500);
  }
}
