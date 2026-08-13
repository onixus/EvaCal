import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  SHARE_DEFAULT_TTL_SECONDS,
  ShareScope,
  createShareToken,
  requireStaff,
} from '@/lib/access';
import { clientIp, writeAudit } from '@/lib/audit';

const ALLOWED_SCOPES: ShareScope[] = ['read', 'write', 'export', 'create'];

/**
 * Staff issues a short-lived share token for a calculation (Horizon A2).
 * Body: { scopes?: ShareScope[], ttlSeconds?: number }
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireStaff();
  if (auth instanceof NextResponse) return auth;

  const exists = await prisma.calculation.findUnique({
    where: { id: params.id },
    select: { id: true, templateId: true },
  });
  if (!exists) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const rawScopes = Array.isArray(body.scopes) ? body.scopes : ['read', 'write', 'export'];
  const scopes = rawScopes.filter((s: unknown): s is ShareScope =>
    ALLOWED_SCOPES.includes(s as ShareScope),
  );
  if (scopes.length === 0) {
    return NextResponse.json({ error: 'scopes is required' }, { status: 400 });
  }

  const ttlSeconds =
    typeof body.ttlSeconds === 'number' && body.ttlSeconds > 0
      ? Math.min(body.ttlSeconds, 60 * 60 * 24 * 30)
      : SHARE_DEFAULT_TTL_SECONDS;

  const token = createShareToken({
    calculationId: params.id,
    templateId: exists.templateId,
    scopes,
    ttlSeconds,
  });

  await writeAudit({
    actorType: 'user',
    actorId: auth.userId,
    action: 'calculation.share.create',
    entityType: 'calculation',
    entityId: params.id,
    meta: { scopes, ttlSeconds },
    ip: clientIp(req),
  });

  const exp = Date.now() + ttlSeconds * 1000;
  return NextResponse.json({
    token,
    scopes,
    expiresAt: new Date(exp).toISOString(),
    // Convenience URL fragment for export/read links
    queryParam: `share=${encodeURIComponent(token)}`,
  });
}
