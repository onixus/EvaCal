import { NextRequest, NextResponse } from 'next/server';
import { loadCalculationForExport } from '@/lib/export';
import { buildWizardReview } from '@/lib/gost34/wizard';

/**
 * Экраны проверки мастера (PR-10): требования, применимость, трассируемость и
 * сводка соответствия по одному запросу. Документ здесь не генерируется —
 * выпуск выполняется отдельно, с теми же решениями пользователя.
 *
 * Доступ такой же, как у экспорта расчёта: маршрут читает уже доступный расчёт
 * и считает по нему то же самое, что и генерация документа. Сетевые вызовы и
 * загрузка файлов остаются за отдельными маршрутами с проверкой роли.
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
