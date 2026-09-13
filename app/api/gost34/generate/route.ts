import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { GOST34_LLM_ROLES } from '../roles';
import { generateGost34Document, TzAuthorHardFlagsError } from '@/lib/gost34';
import { responseBody } from '@/lib/export';
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
      projectContext,
      manualTraceLinks,
      sectionOverrides,
      tzAuthor,
    } = body;

    const { buffer, filename } = await generateGost34Document({
      calculation,
      metadataOverride,
      rawRequirements,
      projectContext,
      manualTraceLinks,
      sectionOverrides,
      tzAuthor,
    });

    return new NextResponse(responseBody(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(buffer.length),
      },
    });
  } catch (err: unknown) {
    if (err instanceof TzAuthorHardFlagsError) {
      return NextResponse.json(
        { error: 'tz_author_hard_flags', nodes: err.nodes },
        { status: 409 },
      );
    }
    return handleApiError(err, 'Failed to generate document', 500);
  }
}
