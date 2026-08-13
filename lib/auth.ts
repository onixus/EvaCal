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

export function createSessionToken(user: { id: string; username: string; role: string }): string {
  const payload: SessionPayload = {
    userId: user.id,
    username: user.username,
    role: user.role,
    exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
  };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${data}.${sign(data)}`;
}

export function verifySessionToken(token: string | undefined | null): SessionPayload | null {
  if (!token) return null;
  const [data, signature] = token.split('.');
  if (!data || !signature || !safeEqual(signature, sign(data))) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString()) as SessionPayload;
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
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
  if (!allowed.includes(session.role)) {
    return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 });
  }
  return session;
}
