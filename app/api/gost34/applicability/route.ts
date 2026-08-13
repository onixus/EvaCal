import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { buildProjectContext } from '@/lib/gost34/context';
import {
  evaluateApplicability,
  getApplicabilitySummary,
  toEnrichmentOptions,
} from '@/lib/gost34/applicability';
import { handleApiError } from '@/lib/apiHelpers';
import { GOST34_LLM_ROLES } from '../roles';

/**
 * Оценка применимости нормативных актов и стандартов (Applicability Engine, PR-05).
 * Принимает ProjectContext либо данные опросника (answers), а также ручные overrides.
 */
export async function POST(req: NextRequest) {
  const session = await requireApiRole(GOST34_LLM_ROLES);
  if (session instanceof NextResponse) return session;

  try {
    const body = await req.json();
    const { projectContext, answers, overrides, systemName, customerName } = body;

    const context =
      projectContext ||
      buildProjectContext({
        systemName: systemName || 'Автоматизированная система',
        customerName: customerName || 'Заказчик',
        answers: answers || {},
      });

    const results = evaluateApplicability(context, overrides);
    const summary = getApplicabilitySummary(results);
    const options = toEnrichmentOptions(results);

    return NextResponse.json({
      results,
      summary,
      options,
    });
  } catch (err: unknown) {
    console.error('Error in GOST 34 applicability endpoint:', err);
    return handleApiError(err, 'Applicability evaluation failed', 500);
  }
}
