import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { clientIp, writeAudit } from '@/lib/audit';
import { decideNormProposal, type NormDecision } from '@/lib/normProposalsData';

const MAX_COMMENT = 2000;

/**
 * Решение по предложению норматива: `{ decision: 'approve' | 'reject', comment }`.
 * Утверждение меняет только этап шаблона — новые расчёты получат новый
 * норматив, существующие не пересчитываются. Отклонение требует комментария.
 */
export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string; proposalId: string }> },
) {
  const auth = await requireApiRole('admin');
  if (auth instanceof NextResponse) return auth;
  const { id, proposalId } = await props.params;

  const body = await req.json().catch(() => ({}));
  const decision = body?.decision as NormDecision;
  if (decision !== 'approve' && decision !== 'reject') {
    return NextResponse.json({ error: 'decision: approve или reject' }, { status: 400 });
  }
  const comment = typeof body.comment === 'string' ? body.comment.trim() : '';
  if (comment.length > MAX_COMMENT) {
    return NextResponse.json({ error: 'Комментарий длиннее 2000 символов' }, { status: 400 });
  }
  if (decision === 'reject' && !comment) {
    return NextResponse.json({ error: 'Укажите причину отклонения' }, { status: 400 });
  }

  const result = await decideNormProposal({
    formTemplateId: id,
    proposalId,
    decision,
    decidedBy: auth.username,
    comment: comment || null,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  await writeAudit({
    actorType: 'user',
    actorId: auth.userId,
    action: decision === 'approve' ? 'template.norms.approve' : 'template.norms.reject',
    entityType: 'template',
    entityId: id,
    meta: {
      proposalId,
      stageTemplateId: result.proposal.stageTemplateId,
      before: result.before,
      after: result.after,
    },
    ip: clientIp(req),
  });
  return NextResponse.json({ proposal: result.proposal, after: result.after });
}
