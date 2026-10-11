import { NextRequest, NextResponse } from 'next/server';
import { actorTypeFromAccess, clientIp, writeAudit } from '@/lib/audit';
import { handleApiError } from '@/lib/apiHelpers';
import { loadPackageForRead, loadPackageForWrite } from '@/lib/acceptance/http';
import { validateDecisionInput } from '@/lib/acceptance/decision';
import { decisionInputs, loadDecisionState, recordDecision } from '@/lib/acceptance/decisionStore';
import { listChecksWithFlags } from '@/lib/acceptance/store';

type Props = { params: Promise<{ id: string }> };

/** Действующее решение комиссии по редакции, признак устаревания и история. */
export async function GET(req: NextRequest, props: Props) {
  try {
    const { id } = await props.params;
    const loaded = await loadPackageForRead(req, id);
    if (loaded instanceof NextResponse) return loaded;
    const checks = await listChecksWithFlags(loaded.pkg);
    return NextResponse.json(await loadDecisionState(loaded.pkg.id, checks));
  } catch (err) {
    return handleApiError(err, 'Failed to load acceptance decision', 500);
  }
}

/**
 * Записать решение комиссии: `decision` (accepted | accepted_with_remarks |
 * rejected), `commission` [{ name, position?, organization? }], `basis`,
 * `exceptions` [{ checkId, note }] для «принять с замечаниями». Правила — в
 * `lib/acceptance/decision.ts`; решение проверяется по текущим фактам и
 * фиксирует их снимок. Новое решение не меняет прежние — оно дописывается.
 */
export async function POST(req: NextRequest, props: Props) {
  try {
    const { id } = await props.params;
    const loaded = await loadPackageForWrite(req, id);
    if (loaded instanceof NextResponse) return loaded;
    const { pkg, access, actor } = loaded;

    const body = await req.json().catch(() => ({}));
    const checks = await listChecksWithFlags(pkg);
    const valid = validateDecisionInput(
      {
        decision: body?.decision,
        commission: body?.commission,
        basis: body?.basis,
        exceptions: body?.exceptions,
      },
      decisionInputs(checks),
    );
    if (!valid.ok) return NextResponse.json({ error: valid.error }, { status: valid.status });

    const decision = await recordDecision({
      packageId: pkg.id,
      value: valid.value,
      decidedBy: actor.name,
      decidedById: actor.id,
    });

    await writeAudit({
      actorType: actorTypeFromAccess(access.kind),
      actorId: actor.id,
      action: 'acceptance_decision.record',
      entityType: 'gost_package',
      entityId: pkg.id,
      meta: {
        decisionId: decision.id,
        decision: decision.decision,
        exceptions: decision.exceptions.map((e) => e.requirementCode),
        checks: valid.value.checksSnapshot.length,
      },
      ip: clientIp(req),
    });

    return NextResponse.json({ decision }, { status: 201 });
  } catch (err) {
    return handleApiError(err, 'Failed to record acceptance decision', 500);
  }
}
