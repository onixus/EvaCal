import { NextResponse } from 'next/server';
import { SpecificationError } from '../specification/validation';
import { SizingError } from './engine';
import type { AccessContext } from '../access';
import { SIZING_EDIT_ROLES } from './types';

/** Редактировать профили и считать по черновикам могут архитектор и администратор. */
export function canEditSizingProfiles(access: AccessContext): boolean {
  return access.kind === 'staff' && SIZING_EDIT_ROLES.includes(access.session?.role || '');
}

/** Те же права записи, что показывает панель спецификации. */
export function canWriteCalculation(access: AccessContext): boolean {
  return (
    access.kind === 'anonymous' ||
    (access.kind === 'staff' &&
      ['admin', 'architect', 'presale'].includes(access.session?.role || '')) ||
    Boolean(access.share?.scopes.includes('write'))
  );
}

export function sizingError(error: unknown, fallback = 'Ошибка сайзинга') {
  const status =
    error instanceof SizingError || error instanceof SpecificationError
      ? error.statusCode
      : error instanceof SyntaxError
        ? 400
        : 500;
  if (status === 500) console.error('[sizing]', error);
  return NextResponse.json(
    { error: status === 500 ? fallback : (error as Error).message },
    { status, headers: { 'Cache-Control': 'private, no-store' } },
  );
}
