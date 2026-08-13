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

export function clientIp(req: { headers: Headers }): string | null {
  const xf = req.headers.get('x-forwarded-for');
  if (xf) return xf.split(',')[0]?.trim() || null;
  return req.headers.get('x-real-ip');
}
