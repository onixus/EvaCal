/**
 * Общие части маршрутов `/api/calculations/:id/kits/*` (#103 WP-7b).
 * Доступ — архитектор и администратор (те же роли, что правят этапы расчёта
 * и библиотеку решений).
 */
import { NextResponse } from 'next/server';
import { parseVersionParam } from '@/lib/solutionKits/http';
import type { KitAppResult } from './store';

export { readJson, requireKitLibrary as requireKitApplicationRole } from '@/lib/solutionKits/http';

export function kitFailure(result: Extract<KitAppResult<object>, { ok: false }>) {
  return NextResponse.json({ error: result.error }, { status: result.status });
}

/** kitId — непустая строка; version — целое ≥ 1 или отсутствует. */
export function kitTarget(
  body: Record<string, unknown>,
): { kitId: string; version?: number } | NextResponse {
  const kitId = typeof body.kitId === 'string' ? body.kitId.trim() : '';
  if (!kitId) return NextResponse.json({ error: 'kitId обязателен' }, { status: 400 });
  if (body.version === undefined || body.version === null) return { kitId };
  const version = parseVersionParam(String(body.version));
  if (!version) {
    return NextResponse.json({ error: 'version — целое число от 1' }, { status: 400 });
  }
  return { kitId, version };
}
