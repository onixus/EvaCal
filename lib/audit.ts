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

/**
 * Redacts metadata for LLM audit events to prevent sensitive prompts,
 * prose texts, requirements, or credentials from being persisted to AuditEvent.
 */
export const SENSITIVE_LLM_KEYS = new Set([
  'prompt',
  'messages',
  'response',
  'paragraphs',
  'text',
  'content',
  'apiKey',
  'endpoint',
  'headers',
  'body',
  'token',
  'authorization',
  'rawRequirements',
  'projectContext',
  'context',
  'draftParagraphs',
  'baselineParagraphs',
]);

export function redactLlmMeta(
  meta: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!meta || typeof meta !== 'object') return {};
  const cleaned: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(meta)) {
    if (SENSITIVE_LLM_KEYS.has(key)) continue;
    // Disallow long strings (> 200 chars) as potential prose/prompt leaks
    if (typeof val === 'string' && val.length > 200) continue;
    cleaned[key] = val;
  }
  return cleaned;
}

export async function writeAudit(input: AuditWriteInput): Promise<void> {
  try {
    let meta = input.meta;
    if (meta && (input.action.startsWith('gost34.tz_author.') || input.action.includes('llm'))) {
      meta = redactLlmMeta(meta);
    }
    await prisma.auditEvent.create({
      data: {
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        action: input.action,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        meta: meta ? JSON.stringify(meta) : null,
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
