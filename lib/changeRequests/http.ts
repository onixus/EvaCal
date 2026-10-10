import { NextResponse } from 'next/server';
import { ChangeRequestError } from './workflow';

/** Ошибка предметной области → её статус; остальное — 500 без подробностей. */
export function changeRequestErrorResponse(error: unknown): NextResponse {
  if (error instanceof ChangeRequestError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error('[change-requests]', error);
  return NextResponse.json({ error: 'Не удалось обработать запрос на изменение' }, { status: 500 });
}
