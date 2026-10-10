import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { clientIp, writeAudit } from '@/lib/audit';
import { changeRequestErrorResponse } from '@/lib/changeRequests/http';
import {
  createChangeRequest,
  listChangeRequests,
  loadBaseRequirements,
} from '@/lib/changeRequests/store';
import { CHANGE_REQUEST_EDIT_ROLES, parseDraftInput } from '@/lib/changeRequests/workflow';

/**
 * Запросы на изменение требований проекта (#103 WP-2a).
 * GET — список; `?packageId=` — требования базового комплекта для выбора.
 * POST — новый черновик. База (расчёт, этапы, комплект) только читается.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(CHANGE_REQUEST_EDIT_ROLES);
  if (auth instanceof NextResponse) return auth;
  const { id } = await props.params;
  try {
    const packageId = new URL(req.url).searchParams.get('packageId')?.trim();
    if (packageId) {
      return NextResponse.json({ requirements: await loadBaseRequirements(id, packageId) });
    }
    return NextResponse.json({ changeRequests: await listChangeRequests(id) });
  } catch (error) {
    return changeRequestErrorResponse(error);
  }
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(CHANGE_REQUEST_EDIT_ROLES);
  if (auth instanceof NextResponse) return auth;
  const { id } = await props.params;
  try {
    const input = parseDraftInput(await req.json().catch(() => null));
    const created = await createChangeRequest(id, input, auth.username);
    await writeAudit({
      actorType: 'user',
      actorId: auth.userId,
      action: 'change_request.create',
      entityType: 'change_request',
      entityId: created.id,
      meta: { projectId: id, seq: created.seq, baseCalculationId: created.baseCalculationId },
      ip: clientIp(req),
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return changeRequestErrorResponse(error);
  }
}
