import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireStaff } from '@/lib/access';
import { handleApiError } from '@/lib/apiHelpers';
import {
  HarnessAgentValidationError,
  getManagedAgent,
  toPublicAgent,
  validateAgentInput,
} from '@/lib/gost34/agents/registry';
import { EndpointNotAllowedError } from '@/lib/gost34/llm/endpointGuard';

type Params = { params: Promise<{ id: string }> };

/** Правка и удаление агента: владелец или админ. */

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const session = await requireStaff();
    if (session instanceof NextResponse) return session;

    const { id } = await params;
    const existing = await getManagedAgent(id, session.userId, session.role === 'admin');
    if (!existing) return NextResponse.json({ error: 'Агент не найден' }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const data = validateAgentInput(body, true);
    const agent = await prisma.harnessAgent.update({
      where: { id },
      data,
      include: { owner: { select: { username: true } } },
    });
    return NextResponse.json({ agent: toPublicAgent(agent) });
  } catch (err) {
    if (err instanceof HarnessAgentValidationError || err instanceof EndpointNotAllowedError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return handleApiError(err, 'Не удалось обновить агента');
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const session = await requireStaff();
    if (session instanceof NextResponse) return session;

    const { id } = await params;
    const existing = await getManagedAgent(id, session.userId, session.role === 'admin');
    if (!existing) return NextResponse.json({ error: 'Агент не найден' }, { status: 404 });

    await prisma.harnessAgent.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err, 'Не удалось удалить агента');
  }
}
