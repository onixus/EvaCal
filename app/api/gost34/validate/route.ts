import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { fromGost34RequirementItems } from '@/lib/gost34/requirements';
import { validateRequirements } from '@/lib/gost34/validation';
import { GOST34_LLM_ROLES } from '../roles';

/**
 * Проверка набора требований валидаторами ГОСТ 34 без генерации документа.
 * Принимает требования в модели v2 либо в старой модели Gost34RequirementItem.
 */
export async function POST(req: NextRequest) {
  const session = await requireApiRole(GOST34_LLM_ROLES);
  if (session instanceof NextResponse) return session;

  try {
    const body = await req.json();
    const { requirements = [], requirementsV2, rules } = body;

    const toValidate = Array.isArray(requirementsV2)
      ? requirementsV2
      : fromGost34RequirementItems(Array.isArray(requirements) ? requirements : []);

    if (toValidate.length === 0) {
      return NextResponse.json({ error: 'Requirements array is empty' }, { status: 400 });
    }

    return NextResponse.json({
      validation: validateRequirements(toValidate, { rules }),
    });
  } catch (err: any) {
    console.error('Error in GOST 34 validation endpoint:', err);
    return NextResponse.json({ error: err?.message || 'Validation failed' }, { status: 500 });
  }
}
