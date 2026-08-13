import { NextResponse } from 'next/server';

/**
 * Standardized API error response creator.
 * Formats errors consistently, extracts error message and logs appropriately.
 */
export function handleApiError(
  error: unknown,
  fallbackMessage = 'Internal Server Error',
  statusCode = 500,
): NextResponse<{ error: string }> {
  const message = error instanceof Error ? error.message : String(error || fallbackMessage);
  return NextResponse.json({ error: message || fallbackMessage }, { status: statusCode });
}

/**
 * Standardized API success response helper.
 */
export function apiSuccess<T>(data: T, status = 200): NextResponse<T> {
  return NextResponse.json(data, { status });
}
