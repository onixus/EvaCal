import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { actorTypeFromAccess, clientIp, writeAudit } from '@/lib/audit';
import { handleApiError } from '@/lib/apiHelpers';
import { loadPackageForWrite } from '@/lib/acceptance/http';
import { parseEvidenceRefs, validateResultInput } from '@/lib/acceptance/rules';
import { loadCheck, recordResult, resolveEvidence } from '@/lib/acceptance/store';

type Props = { params: Promise<{ id: string; checkId: string }> };

/**
 * Записать результат проверки. Каждая запись — новая строка журнала:
 * повторная проверка не переписывает предыдущую. Исполнитель — либо сам
 * записывающий (`executorSelf: true`), либо названное лицо (член комиссии,
 * представитель Заказчика) в `executorName`; записавшего фиксирует сервер.
 */
export async function POST(req: NextRequest, props: Props) {
  try {
    const { id, checkId } = await props.params;
    const loaded = await loadPackageForWrite(req, id);
    if (loaded instanceof NextResponse) return loaded;
    const { pkg, access, actor } = loaded;

    const check = await loadCheck(pkg.id, checkId);
    if (!check) return NextResponse.json({ error: 'Проверка не найдена' }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const self = body?.executorSelf === true;
    let executorId: string | null = null;
    let executorName: unknown = body?.executorName;
    if (self) {
      executorId = actor.id;
      executorName = actor.name;
    } else if (typeof body?.executorId === 'string' && body.executorId) {
      const user = await prisma.user.findUnique({
        where: { id: body.executorId },
        select: { id: true, username: true },
      });
      if (!user) return NextResponse.json({ error: 'Исполнитель не найден' }, { status: 400 });
      executorId = user.id;
      executorName =
        typeof executorName === 'string' && executorName.trim() ? executorName : user.username;
    }

    const valid = validateResultInput({
      status: body?.status,
      executorName,
      executedAt: body?.executedAt,
      actualResult: body?.actualResult,
    });
    if (!valid.ok) return NextResponse.json({ error: valid.error }, { status: valid.status });

    const refs = parseEvidenceRefs(body?.evidence, pkg.id, check.id);
    if (!refs.ok) return NextResponse.json({ error: refs.error }, { status: refs.status });
    const evidence = await resolveEvidence(refs.value);
    if (!evidence.ok) {
      return NextResponse.json({ error: evidence.error }, { status: evidence.status });
    }

    const remarkText =
      typeof body?.remark === 'string' ? body.remark.trim().slice(0, 4000) || null : null;

    const recorded = await recordResult({
      checkId: check.id,
      result: valid.value,
      executorId,
      evidence: evidence.value,
      recordedBy: actor.name,
      remarkText,
    });

    await writeAudit({
      actorType: actorTypeFromAccess(access.kind),
      actorId: actor.id,
      action: 'acceptance_result.record',
      entityType: 'gost_package',
      entityId: pkg.id,
      meta: {
        checkId: check.id,
        requirementCode: check.requirementCode,
        resultId: recorded.result.id,
        status: recorded.result.status,
        previousStatus: check.status,
        evidence: evidence.value.length,
      },
      ip: clientIp(req),
    });

    return NextResponse.json(recorded, { status: 201 });
  } catch (err) {
    return handleApiError(err, 'Failed to record acceptance result', 500);
  }
}
