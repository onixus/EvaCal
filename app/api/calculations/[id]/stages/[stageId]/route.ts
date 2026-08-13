import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiRole } from '@/lib/auth';

const ALLOWED_STATUSES = ['planned', 'in_progress', 'done', 'approved', 'rejected'];

// Lightweight status update only — dates/hours are owned by the stage-rebuild flow.
export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ id: string; stageId: string }> },
) {
  const params = await props.params;
  const auth = await requireApiRole(['architect', 'admin']);
  if (auth instanceof NextResponse) return auth;

  const body = await req.json();
  if (!ALLOWED_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: 'invalid status' }, { status: 400 });
  }
  const stage = await prisma.stage.update({
    where: { id: params.stageId },
    data: { status: body.status },
  });
  return NextResponse.json(stage);
}
