/**
 * Общие части маршрутов `/api/solution-kits/*` (#103 WP-7a): допуск к
 * библиотеке, разбор номера версии, ответ по результату хранилища, аудит.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole, type SessionPayload } from '@/lib/auth';
import { clientIp, writeAudit } from '@/lib/audit';
import { KIT_LIBRARY_ROLES } from './rules';
import type { KitResult, KitActorWithName } from './store';

export async function requireKitLibrary(): Promise<SessionPayload | NextResponse> {
  return requireApiRole([...KIT_LIBRARY_ROLES]);
}

export function actorOf(session: SessionPayload): KitActorWithName {
  return { userId: session.userId, role: session.role, username: session.username };
}

/** Номер версии из пути: целое ≥ 1, иначе null. */
export function parseVersionParam(raw: string | null | undefined): number | null {
  if (!raw || !/^\d{1,6}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 ? n : null;
}

export function badVersion() {
  return NextResponse.json({ error: 'Номер версии — целое число от 1' }, { status: 400 });
}

export function failure(result: Extract<KitResult<object>, { ok: false }>) {
  return NextResponse.json(
    { error: result.error, ...(result.issues ? { issues: result.issues } : {}) },
    { status: result.status },
  );
}

export async function readJson(req: NextRequest): Promise<Record<string, unknown> | null> {
  const body = await req.json().catch(() => null);
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

export async function auditKit(
  req: NextRequest,
  session: SessionPayload,
  action: string,
  kitId: string,
  meta?: Record<string, unknown>,
) {
  await writeAudit({
    actorType: 'user',
    actorId: session.userId,
    action: `solution_kit.${action}`,
    entityType: 'solution_kit',
    entityId: kitId,
    meta,
    ip: clientIp(req),
  });
}
