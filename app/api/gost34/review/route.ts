import { NextRequest, NextResponse } from 'next/server';
import { loadCalculationForExport } from '@/lib/export';
import { buildWizardReview } from '@/lib/gost34/wizard';
import { requireCalcAccess } from '@/lib/access';

/**
 * Экраны проверки мастера (PR-10): требования, применимость, трассируемость и
 * сводка соответствия по одному запросу. Документ здесь не генерируется —
 * выпуск выполняется отдельно, с теми же решениями пользователя.
 *
 * Доступ: staff session или share-токен на расчёт (read/export).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      calculationId,
      rawRequirements = [],
      vendorFiles = [],
      standardProfileId,
      applicabilityOverrides,
      manualLinks = [],
      projectContext,
      signatures,
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

    const review = buildWizardReview(
      {
        calculation: calculation as any,
        rawRequirements,
        vendorFiles,
        standardProfileId,
        applicabilityOverrides,
        manualLinks,
        projectContext,
      },
      signatures,
    );

    return NextResponse.json(review);
  } catch (err: any) {
    console.error('Error in GOST 34 wizard review endpoint:', err);
    return NextResponse.json({ error: err?.message || 'Review failed' }, { status: 500 });
  }
}
