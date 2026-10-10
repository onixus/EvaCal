import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiRole } from '@/lib/auth';
import { clientIp, writeAudit } from '@/lib/audit';
import { generateNormProposals, listNormProposals } from '@/lib/normProposalsData';

/**
 * Предложения нормативов этапов шаблона по факту (#103 WP-6c). Только
 * владелец шаблонов — администратор.
 * GET — список (последние сначала); POST — пересчитать по текущему факту.
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole('admin');
  if (auth instanceof NextResponse) return auth;
  const { id } = await props.params;
  const proposals = await listNormProposals(id);
  return NextResponse.json({ proposals });
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole('admin');
  if (auth instanceof NextResponse) return auth;
  const { id } = await props.params;
  const template = await prisma.formTemplate.findUnique({ where: { id }, select: { id: true } });
  if (!template) return NextResponse.json({ error: 'Шаблон не найден' }, { status: 404 });

  const summary = await generateNormProposals(id, auth.username);
  await writeAudit({
    actorType: 'user',
    actorId: auth.userId,
    action: 'template.norms.generate',
    entityType: 'template',
    entityId: id,
    meta: {
      created: summary.created,
      unchanged: summary.unchanged,
      superseded: summary.superseded,
      skipped: summary.skipped.length,
    },
    ip: clientIp(req),
  });
  const proposals = await listNormProposals(id);
  return NextResponse.json({ summary, proposals });
}
