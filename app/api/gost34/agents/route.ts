import { NextRequest, NextResponse } from 'next/server';
import { requireStaff } from '@/lib/access';
import { handleApiError } from '@/lib/apiHelpers';
import {
  HarnessAgentValidationError,
  createAgent,
  listAgentsFor,
} from '@/lib/gost34/agents/registry';
import { EndpointNotAllowedError } from '@/lib/gost34/llm/endpointGuard';

/**
 * Реестр харнесс-агентов архитектора/ГИПа. Доступ — только staff (architect |
 * admin): пресейл и ревьювер внешних агентов не подключают.
 */

export async function GET() {
  try {
    const session = await requireStaff();
    if (session instanceof NextResponse) return session;

    const agents = await listAgentsFor(session.userId, session.role === 'admin');
    return NextResponse.json({ agents });
  } catch (err) {
    return handleApiError(err, 'Не удалось получить список агентов');
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireStaff();
    if (session instanceof NextResponse) return session;

    const body = await req.json().catch(() => ({}));
    const agent = await createAgent(session.userId, body);
    return NextResponse.json({ agent }, { status: 201 });
  } catch (err) {
    if (err instanceof HarnessAgentValidationError || err instanceof EndpointNotAllowedError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return handleApiError(err, 'Не удалось создать агента');
  }
}
