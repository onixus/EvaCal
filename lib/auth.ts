import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';

export const SESSION_COOKIE_NAME = 'evacal_session';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8; // 8h

export interface SessionPayload {
  userId: string;
  username: string;
  role: string;
  exp: number;
  /**
   * Пароль выдан сидом/сбросом и ещё не менялся. Пока флаг стоит, все гейты
   * (`requireRole`, `requireApiRole`, `requireStaff`, `requireCalcAccess`…)
   * отвечают отказом — доступны только /account и auth-роуты. Снимается
   * перевыпуском токена в /api/auth/change-password.
   */
  mustChangePassword?: boolean;
}

export const PASSWORD_CHANGE_REQUIRED_CODE = 'password_change_required';

export function passwordChangeRequired(session: SessionPayload | null | undefined): boolean {
  return session?.mustChangePassword === true;
}

/** 403 для API-роутов, когда сессия валидна, но пароль ещё не сменён. */
export function passwordChangeRequiredResponse(): NextResponse {
  return NextResponse.json(
    {
      error: 'Смените выданный пароль в /account, прежде чем продолжить',
      code: PASSWORD_CHANGE_REQUIRED_CODE,
    },
    { status: 403 },
  );
}

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not set. Add it to your .env file.');
  return secret;
}

function sign(data: string): string {
  return crypto.createHmac('sha256', getSecret()).update(data).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// In-memory revocation store for invalidated sessions/tokens with TTL cleanup
const revokedTokens = new Map<string, number>();

function cleanRevokedTokens(): void {
  const now = Date.now();
  for (const [sig, exp] of revokedTokens.entries()) {
    if (exp <= now) {
      revokedTokens.delete(sig);
    }
  }
}

/** Explicitly revokes a session token so it cannot be reused before TTL expiry. */
export function revokeSession(token: string | undefined | null): void {
  if (!token) return;
  const parts = token.split('.');
  if (parts.length < 2) return;
  const [data, signature] = parts;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString()) as SessionPayload;
    const exp =
      typeof payload.exp === 'number' ? payload.exp : Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
    revokedTokens.set(signature, exp);
    if (revokedTokens.size > 1000) cleanRevokedTokens();
  } catch {
    revokedTokens.set(signature, Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  }
}

/**
 * Момент, начиная с которого сессии пользователя недействительны.
 *
 * Роль зашита в подписанный токен, поэтому смена роли обязана обесценить уже
 * выданные сессии: иначе бывший ГАП доработал бы смену со старой подписью.
 * Самих токенов на руках нет — храним время смены и отвергаем всё, что
 * выпущено раньше.
 */
const userRevocationCutoff = new Map<string, number>();

/** Отзывает все сессии пользователя: выданные до этого момента больше не годны. */
export function revokeSessionsForUser(userId: string): void {
  if (!userId) return;
  userRevocationCutoff.set(userId, Date.now());
}

function isUserSessionRevoked(payload: SessionPayload): boolean {
  const cutoff = userRevocationCutoff.get(payload.userId);
  if (!cutoff) return false;
  const issuedAt = payload.exp - SESSION_MAX_AGE_SECONDS * 1000;
  return issuedAt < cutoff;
}

/** Checks whether a session token has been revoked. */
export function isSessionRevoked(token: string | undefined | null): boolean {
  if (!token) return true;
  const parts = token.split('.');
  if (parts.length < 2) return true;
  const [, signature] = parts;
  const exp = revokedTokens.get(signature);
  if (!exp) return false;
  if (exp <= Date.now()) {
    revokedTokens.delete(signature);
    return false;
  }
  return true;
}

/** Clears revoked tokens store (intended for unit tests). */
export function clearRevocationsForTesting(): void {
  revokedTokens.clear();
  userRevocationCutoff.clear();
}

export function createSessionToken(user: {
  id: string;
  username: string;
  role: string;
  mustChangePassword?: boolean;
}): string {
  const payload: SessionPayload = {
    userId: user.id,
    username: user.username,
    role: user.role,
    exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
    ...(user.mustChangePassword ? { mustChangePassword: true } : {}),
  };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${data}.${sign(data)}`;
}

export function verifySessionToken(token: string | undefined | null): SessionPayload | null {
  if (!token) return null;
  if (isSessionRevoked(token)) return null;
  const [data, signature] = token.split('.');
  if (!data || !signature || !safeEqual(signature, sign(data))) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString()) as SessionPayload;
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    if (isUserSessionRevoked(payload)) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Reads the session from cookies — usable in Server Components, layouts and Route Handlers. */
export async function getSession(): Promise<SessionPayload | null> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  return verifySessionToken(token);
}

/**
 * For Server Components / layouts: redirects to /login when the required role isn't present.
 *
 * `next` is where the user lands after logging in. Pass the guarded surface itself: a page
 * that accepts several roles must not derive it from the role list, because picking the
 * admin-only route merely because admin is also accepted sends an architect who asked for
 * /architect to a page their role cannot open.
 */
export async function requireRole(role: string | string[], next?: string): Promise<SessionPayload> {
  const allowed = Array.isArray(role) ? role : [role];
  const session = await getSession();
  if (session && passwordChangeRequired(session)) redirect('/account');
  if (!session || !allowed.includes(session.role)) {
    const target =
      next ??
      (allowed.includes('architect')
        ? '/architect'
        : allowed.includes('admin')
          ? '/admin'
          : `/${allowed[0]}`);
    redirect(`/login?next=${encodeURIComponent(target)}`);
  }
  return session as SessionPayload;
}

/**
 * For Route Handlers: returns the session, or an error NextResponse to return
 * immediately. Accepts several acceptable roles — a route that an architect may
 * call is usually one an admin may call too.
 */
export async function requireApiRole(
  role: string | string[],
): Promise<SessionPayload | NextResponse> {
  const allowed = Array.isArray(role) ? role : [role];
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Требуется вход в систему' }, { status: 401 });
  if (passwordChangeRequired(session)) return passwordChangeRequiredResponse();
  if (!allowed.includes(session.role)) {
    return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 });
  }
  return session;
}
