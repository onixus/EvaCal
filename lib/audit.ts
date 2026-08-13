/**
 * Lightweight audit trail for sensitive actions (Horizon A3).
 * Failures are logged but never fail the primary request.
 */
import { prisma } from '@/lib/prisma';

export type AuditActorType = 'user' | 'share' | 'system' | 'anonymous';

export interface AuditWriteInput {
  actorType: AuditActorType;
  actorId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  meta?: Record<string, unknown> | null;
  ip?: string | null;
}

export async function writeAudit(input: AuditWriteInput): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        action: input.action,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        meta: input.meta ? JSON.stringify(input.meta) : null,
        ip: input.ip ?? null,
      },
    });
  } catch (err) {
    console.error('[audit] failed to write event', input.action, err);
  }
}

export function actorTypeFromAccess(kind: 'staff' | 'share' | 'anonymous'): AuditActorType {
  if (kind === 'staff') return 'user';
  if (kind === 'share') return 'share';
  return 'anonymous';
}

/**
 * Client address for the audit trail, taken only from what the reverse proxy itself set.
 *
 * nginx sets `X-Real-IP $remote_addr` (overwriting anything the caller sent) and
 * `X-Forwarded-For $proxy_add_x_forwarded_for`, which *appends* the real peer to a
 * client-supplied chain. Reading the first entry of that chain therefore lets any caller
 * choose the address recorded against their own failed logins and sensitive actions, so
 * prefer X-Real-IP and otherwise take the last hop — the one the proxy appended.
 */
export function clientIp(req: { headers: Headers }): string | null {
  const real = req.headers.get('x-real-ip')?.trim();
  if (real) return real;

  const chain = req.headers.get('x-forwarded-for');
  if (!chain) return null;
  const hops = chain
    .split(',')
    .map((hop) => hop.trim())
    .filter(Boolean);
  return hops.length > 0 ? hops[hops.length - 1] : null;
}
