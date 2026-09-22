import { NextRequest, NextResponse } from 'next/server';
import { loadCalculationForExport } from '@/lib/export';
import { prepareGost34Document } from '@/lib/gost34/generation/prepareDocument';
import { gost34ErrorResponse } from '@/lib/gost34/generation/apiError';
import { requireCalcAccess } from '@/lib/access';
import { handleApiError } from '@/lib/apiHelpers';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      calculationId,
      docType = 'TZ',
      contractNumber,
      city,
      signatures,
      layoutProfileId,
      enrich = true,
      enrichmentOptions,
      rawRequirements = [],
      vendorFiles = [],
      standardProfileId,
      applicabilityOverrides,
      manualLinks = [],
      projectContext,
      sectionOverrides = {},
      tzAuthor,
      includeProposed = false,
    } = body;

    if (!calculationId) {
      return NextResponse.json({ error: 'calculationId is required' }, { status: 400 });
    }

    const access = await requireCalcAccess(req, calculationId, ['read']);
    if (access instanceof NextResponse) return access;

    const calculation = await loadCalculationForExport(calculationId);
    if (!calculation) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    const prepared = prepareGost34Document(
      {
        calculation,
        rawRequirements,
        vendorFiles,
        projectContext,
        metadataOverride: {
          docType,
          contractNumber,
          city,
          signatures,
          layoutProfileId,
          enrichRequirements: Boolean(enrich),
          enrichmentOptions,
          standardProfileId,
          applicabilityOverrides,
        },
        manualTraceLinks: manualLinks,
        sectionOverrides,
        tzAuthor,
      },
      { mode: 'preview', includeProposed: Boolean(includeProposed) },
    );

    return NextResponse.json(prepared);
  } catch (err: unknown) {
    console.error('Error in GOST 34 document preview endpoint:', err);
    return gost34ErrorResponse(err) || handleApiError(err, 'Preview generation failed', 500);
  }
}
