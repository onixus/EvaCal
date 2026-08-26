/**
 * Calculation / export access control (Horizon A).
 *
 * Staff (architect | admin) have full access via session cookie.
 * Presale and external readers use short-lived HMAC share tokens
 * (scopes: read | write | export | create).
 *
 * ALLOW_ANONYMOUS_PRESALE=true restores the legacy open data-plane for local demos only.
 */
import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getSession, SessionPayload } from '@/lib/auth';

/**
 * Роли с полными правами на расчёты и проекты. Намеренно не расширяется
 * пресейлом и ревьювером: `requireStaff` охраняет удаление расчётов, правку
 * проектов и выпуск share-ссылок — там нужен именно архитектор или админ.
 */
export const STAFF_ROLES = ['architect', 'admin'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export type ShareScope = 'read' | 'write' | 'export' | 'create' | 'review';

/**
 * Права ролей на конкретный расчёт. Пресейл создаёт и правит свои расчёты, но
 * не согласовывает; ревьювер читает и выносит вердикт, но не переписывает
 * расчёт. Архитектор и админ могут всё.
 *
 * Набор нарочно совпадает по форме с `ShareScope`, чтобы вошедший сотрудник и
 * гость по ссылке проверялись одной и той же логикой, а не двумя разными.
 */
const ROLE_SCOPES: Record<string, ShareScope[]> = {
  admin: ['read', 'write', 'export', 'create', 'review'],
  architect: ['read', 'write', 'export', 'create', 'review'],
  presale: ['read', 'write', 'export', 'create'],
  reviewer: ['read', 'export', 'review'],
};

function scopesForRole(role: string | undefined | null): ShareScope[] {
  return (role && ROLE_SCOPES[role]) || [];
}

/** Хватает ли роли вошедшего сотрудника на запрошенные права. */
function roleCovers(role: string | undefined | null, need: ShareScope[]): boolean {
  const granted = new Set(scopesForRole(role));
  return need.every((scope) => granted.has(scope));
}

export interface SharePayload {
  /** Bound calculation; omit for create-only tokens. */
  calculationId?: string;
  /** Optional template binding for create tokens. */
  templateId?: string;
  scopes: ShareScope[];
  exp: number;
}

export interface AccessContext {
  kind: 'staff' | 'share' | 'anonymous';
  session?: SessionPayload;
  share?: SharePayload;
  actorId: string;
}

function getShareSecret(): string {
  // Prefer a dedicated secret; fall back to SESSION_SECRET so one env is enough locally.
  const secret = process.env.SHARE_TOKEN_SECRET || process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('SESSION_SECRET (or SHARE_TOKEN_SECRET) is not set.');
  }
  return secret;
}

function sign(data: string): string {
  return crypto.createHmac('sha256', getShareSecret()).update(data).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Default share TTL: 7 days. */
export const SHARE_DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7;

export function createShareToken(
  input: Omit<SharePayload, 'exp'> & { ttlSeconds?: number },
): string {
  const payload: SharePayload = {
    calculationId: input.calculationId,
    templateId: input.templateId,
    scopes: input.scopes,
    exp: Date.now() + (input.ttlSeconds ?? SHARE_DEFAULT_TTL_SECONDS) * 1000,
  };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${data}.${sign(data)}`;
}

export function verifyShareToken(token: string | undefined | null): SharePayload | null {
  if (!token) return null;
  const [data, signature] = token.split('.');
  if (!data || !signature || !safeEqual(signature, sign(data))) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString()) as SharePayload;
    if (!Array.isArray(payload.scopes) || typeof payload.exp !== 'number') return null;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function extractShareToken(req: NextRequest): string | null {
  const header = req.headers.get('x-share-token');
  if (header?.trim()) return header.trim();
  const auth = req.headers.get('authorization');
  if (auth?.toLowerCase().startsWith('share ')) return auth.slice(6).trim();
  const q = req.nextUrl.searchParams.get('share');
  return q?.trim() || null;
}

export function isAnonymousPresaleAllowed(): boolean {
  const raw = (process.env.ALLOW_ANONYMOUS_PRESALE || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

export function isStaffRole(role: string | undefined | null): boolean {
  return !!role && (STAFF_ROLES as readonly string[]).includes(role);
}

function unauthorized(message = 'Требуется вход или действительная share-ссылка') {
  return NextResponse.json({ error: message }, { status: 401 });
}

function forbidden(message = 'Недостаточно прав') {
  return NextResponse.json({ error: message }, { status: 403 });
}

/**
 * Гейт для роутов, которые открыты нескольким внутренним ролям, но не гостям:
 * список расчётов видят и пресейл, и ревьювер, а share-ссылка на него права не
 * даёт. Отличается от `requireCalcAccess` тем, что не принимает ни share-токен,
 * ни анонимный режим — только сессию с достаточной ролью.
 */
export async function requireInternalRole(
  need: ShareScope[],
): Promise<SessionPayload | NextResponse> {
  const session = await getSession();
  if (!session) return unauthorized('Требуется вход в систему');
  if (!roleCovers(session.role, need)) return forbidden();
  return session;
}

/** Staff-only gate (architect or admin). */
export async function requireStaff(): Promise<SessionPayload | NextResponse> {
  const session = await getSession();
  if (!session) return unauthorized('Требуется вход в систему');
  if (!isStaffRole(session.role)) return forbidden();
  return session;
}

/**
 * Access a calculation (or create flow when calculationId is null).
 * Satisfied by: staff session, valid share with required scopes, or anonymous flag.
 */
export async function requireCalcAccess(
  req: NextRequest,
  calculationId: string | null,
  need: ShareScope[],
): Promise<AccessContext | NextResponse> {
  const session = await getSession();
  if (session && scopesForRole(session.role).length > 0) {
    if (!roleCovers(session.role, need)) {
      return forbidden(`Роль «${session.role}» не даёт права: ${need.join(', ')}`);
    }
    return {
      kind: 'staff',
      session,
      actorId: session.userId,
    };
  }

  const share = verifyShareToken(extractShareToken(req));
  if (share) {
    const effective = new Set<ShareScope>(share.scopes);
    // export implies read (load-then-render); write implies read; review implies read.
    if (effective.has('export') || effective.has('write') || effective.has('review')) {
      effective.add('read');
    }
    const missing = need.filter((s) => !effective.has(s));
    if (missing.length > 0) {
      return forbidden(`Share-токен не даёт права: ${missing.join(', ')}`);
    }
    if (calculationId) {
      // create-only tokens must not open arbitrary calculations
      if (share.calculationId && share.calculationId !== calculationId) {
        return forbidden('Share-токен выдан на другой расчёт');
      }
      if (!share.calculationId && !share.scopes.includes('create')) {
        return forbidden('Share-токен не привязан к расчёту');
      }
      // bare create token used against a specific id: allow only if also has write/read as needed
      if (!share.calculationId && need.some((s) => s !== 'create')) {
        return forbidden('Share-токен только на создание');
      }
    }
    return {
      kind: 'share',
      share,
      actorId: `share:${share.calculationId || share.templateId || 'create'}`,
    };
  }

  if (isAnonymousPresaleAllowed()) {
    return {
      kind: 'anonymous',
      actorId: 'anonymous',
    };
  }

  return unauthorized();
}

/** Cookie options for session tokens (login / logout / password change). */
export function sessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true as const,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production' || process.env.FORCE_SECURE_COOKIES === 'true',
    path: '/',
    maxAge,
  };
}

/**
 * Page / RSC access (no NextRequest). Share token comes from `?share=` or an
 * optional explicit string (caller reads searchParams).
 * Returns null when access is denied — pages redirect or render a recovery UI.
 */
export async function resolvePageAccess(
  calculationId: string | null,
  need: ShareScope[],
  shareToken?: string | null,
): Promise<AccessContext | null> {
  const session = await getSession();
  if (session && scopesForRole(session.role).length > 0) {
    if (!roleCovers(session.role, need)) return null;
    return {
      kind: 'staff',
      session,
      actorId: session.userId,
    };
  }

  const share = verifyShareToken(shareToken);
  if (share) {
    const effective = new Set<ShareScope>(share.scopes);
    if (effective.has('export') || effective.has('write') || effective.has('review')) {
      effective.add('read');
    }
    if (need.some((s) => !effective.has(s))) return null;
    if (calculationId) {
      if (share.calculationId && share.calculationId !== calculationId) return null;
      if (!share.calculationId && !share.scopes.includes('create')) return null;
      if (!share.calculationId && need.some((s) => s !== 'create')) return null;
    }
    return {
      kind: 'share',
      share,
      actorId: `share:${share.calculationId || share.templateId || 'create'}`,
    };
  }

  if (isAnonymousPresaleAllowed()) {
    return {
      kind: 'anonymous',
      actorId: 'anonymous',
    };
  }

  return null;
}

/**
 * Сессия любого внутреннего сотрудника для RSC-страниц, или null.
 *
 * Отличается от `getStaffSession` шириной: пресейл и ревьювер — тоже свои, и
 * список расчётов им показывать можно, а править чужие проекты нельзя.
 */
export async function getInternalSession(): Promise<SessionPayload | null> {
  const session = await getSession();
  if (!session || scopesForRole(session.role).length === 0) return null;
  return session;
}

/** Staff session for RSC pages, or null. Does not redirect. */
export async function getStaffSession(): Promise<SessionPayload | null> {
  const session = await getSession();
  if (!session || !isStaffRole(session.role)) return null;
  return session;
}
