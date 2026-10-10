import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { actorTypeFromAccess, clientIp, writeAudit } from '@/lib/audit';
import { handleApiError } from '@/lib/apiHelpers';
import { loadPackageForWrite } from '@/lib/acceptance/http';
import { parseEvidenceIds, validateResultInput } from '@/lib/acceptance/rules';
import { loadCheck, recordResult } from '@/lib/acceptance/store';

type Props = { params: Promise<{ id: string; checkId: string }> };

/**
 * Записать результат проверки. Каждая запись — новая строка журнала:
 * повторная проверка не переписывает предыдущую.
 *
 * Исполнитель задаётся одним из трёх способов, и они не смешиваются:
 *  - `executorSelf: true` — сам записывающий;
 *  - `executorId` — пользователь системы; имя берётся из его учётной записи,
 *    свободный текст `executorName` при этом не принимается;
 *  - `executorName` — ФИО лица вне системы (член комиссии, представитель
 *    Заказчика), без `executorId`.
 * Записавшего фиксирует сервер. Вложения — идентификаторы файлов, ранее
 * загруженных к этой проверке.
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
    const requestedId =
      typeof body?.executorId === 'string' && body.executorId.trim()
        ? body.executorId.trim()
        : null;
    const freeName = typeof body?.executorName === 'string' ? body.executorName.trim() : '';
    if ((self && (requestedId || freeName)) || (requestedId && freeName)) {
      return NextResponse.json(
        { error: 'Укажите исполнителя одним способом: себя, пользователя или ФИО' },
        { status: 400 },
      );
    }
    let executorId: string | null = null;
    let executorName: string = freeName;
    if (self) {
      executorId = actor.id;
      executorName = actor.name;
    } else if (requestedId) {
      const user = await prisma.user.findUnique({
        where: { id: requestedId },
        select: { id: true, username: true },
      });
      if (!user) return NextResponse.json({ error: 'Исполнитель не найден' }, { status: 400 });
      executorId = user.id;
      executorName = user.username;
    }

    const valid = validateResultInput({
      status: body?.status,
      executorName,
      executedAt: body?.executedAt,
      actualResult: body?.actualResult,
    });
    if (!valid.ok) return NextResponse.json({ error: valid.error }, { status: valid.status });

    const evidenceIds = parseEvidenceIds(body?.evidenceIds);
    if (!evidenceIds.ok) {
      return NextResponse.json({ error: evidenceIds.error }, { status: evidenceIds.status });
    }

    const remarkText =
      typeof body?.remark === 'string' ? body.remark.trim().slice(0, 4000) || null : null;

    const recorded = await recordResult({
      checkId: check.id,
      result: valid.value,
      executorId,
      evidenceIds: evidenceIds.value,
      recordedBy: actor.name,
      recordedById: actor.id,
      remarkText,
    });
    if (!recorded.ok) {
      return NextResponse.json({ error: recorded.error }, { status: recorded.status });
    }

    await writeAudit({
      actorType: actorTypeFromAccess(access.kind),
      actorId: actor.id,
      action: 'acceptance_result.record',
      entityType: 'gost_package',
      entityId: pkg.id,
      meta: {
        checkId: check.id,
        requirementCode: check.requirementCode,
        resultId: recorded.value.result.id,
        status: recorded.value.result.status,
        previousStatus: check.status,
        executorId,
        evidenceIds: evidenceIds.value,
      },
      ip: clientIp(req),
    });

    return NextResponse.json(recorded.value, { status: 201 });
  } catch (err) {
    return handleApiError(err, 'Failed to record acceptance result', 500);
  }
}
