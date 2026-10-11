import { NextResponse } from 'next/server';
import { CommercialContourError } from '@/lib/commercialContourData';
import { SpecificationError } from '@/lib/specification/validation';

/** Кто видит коммерческий контур и кто меняет его (#103 §4.2–4.3). */
export const COMMERCIAL_VIEW_ROLES = ['presale', 'architect', 'reviewer', 'admin'];
export const COMMERCIAL_EDIT_ROLES = ['presale', 'architect', 'admin'];
/** Справочник курсов ведут архитектор и администратор. */
export const EXCHANGE_RATE_EDIT_ROLES = ['architect', 'admin'];

export function contourError(error: unknown) {
  if (error instanceof CommercialContourError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof SpecificationError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode });
  }
  console.error('[commercial-contour]', error);
  return NextResponse.json({ error: 'Внутренняя ошибка' }, { status: 500 });
}
