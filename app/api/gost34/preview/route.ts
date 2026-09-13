import { NextRequest, NextResponse } from 'next/server';
import { loadCalculationForExport } from '@/lib/export';
import { analyzeAndNormalizeInput } from '@/lib/gost34/analyzer';
import { buildGost34DocumentAST } from '@/lib/gost34/generator';
import { applySectionOverrides, validateTzAuthorProposals, TzAuthorDiagnostic } from '@/lib/gost34/index';
import { overlaysForDocument } from '@/lib/gost34/llm/tzAuthor/project';
import { GostDocumentType } from '@/lib/gost34/types';
import { requireCalcAccess } from '@/lib/access';
import { handleApiError } from '@/lib/apiHelpers';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      calculationId,
      docType = 'TZ',
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

    const normalizedPayload = analyzeAndNormalizeInput({
      calculation: calculation as any,
      rawRequirements,
      vendorFiles,
      projectContext,
      metadataOverride: {
        docType,
        standardProfileId,
        applicabilityOverrides,
      },
      manualTraceLinks: manualLinks,
    });

    const astWithDiagnostics = buildGost34DocumentAST(normalizedPayload);

    let validTzAuthor = tzAuthor;
    let tzAuthorDiagnostics: TzAuthorDiagnostic[] = [];

    if (docType === 'TZ' && tzAuthor) {
      const validation = validateTzAuthorProposals({
        payload: normalizedPayload,
        context: normalizedPayload.projectContext,
        tzAuthor,
        checkProposed: Boolean(includeProposed),
      });
      validTzAuthor = validation.validTzAuthor;
      tzAuthorDiagnostics = validation.diagnostics;
    }

    const effectiveOverrides = overlaysForDocument({
      docType: docType as GostDocumentType,
      sectionOverrides,
      tzAuthor: validTzAuthor,
      includeProposed: Boolean(includeProposed),
    });

    const overriddenSections =
      Object.keys(effectiveOverrides).length > 0
        ? applySectionOverrides(astWithDiagnostics.sections, effectiveOverrides)
        : astWithDiagnostics.sections;

    return NextResponse.json({
      ast: {
        ...astWithDiagnostics,
        sections: overriddenSections,
      },
      baselineAst: astWithDiagnostics,
      diagnostics: astWithDiagnostics.diagnostics,
      tzAuthorDiagnostics,
    });
  } catch (err: unknown) {
    console.error('Error in GOST 34 document preview endpoint:', err);
    return handleApiError(err, 'Preview generation failed', 500);
  }
}
