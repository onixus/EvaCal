/**
 * Общие части маршрутов `/api/solution-kits/*` (#103 WP-7a): допуск к
 * библиотеке, разбор номера версии, ответ по результату хранилища, аудит.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole, type SessionPayload } from '@/lib/auth';
import { clientIp, writeAudit } from '@/lib/audit';
import { KIT_LIBRARY_ROLES } from './rules';
import { KIT_BODY_MAX_BYTES } from './content';
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

/**
 * Тело запроса библиотеки — JSON-объект не больше `KIT_BODY_MAX_BYTES`.
 * Размер проверяется до разбора: сначала по Content-Length, затем по
 * фактическому потоку (заголовка может не быть). Как `lib/acceptance/http.ts`.
 */
export async function readJson(req: Request): Promise<Record<string, unknown> | NextResponse> {
  const tooLarge = () =>
    NextResponse.json(
      { error: `Тело запроса больше ${Math.round(KIT_BODY_MAX_BYTES / 1024 / 1024)} МБ` },
      { status: 413 },
    );
  const notObject = () => NextResponse.json({ error: 'Ожидается JSON-объект' }, { status: 400 });
  if (Number(req.headers.get('content-length')) > KIT_BODY_MAX_BYTES) return tooLarge();
  const reader = req.body?.getReader();
  if (!reader) return notObject();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > KIT_BODY_MAX_BYTES) {
        await reader.cancel();
        return tooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return notObject();
  }
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : notObject();
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
