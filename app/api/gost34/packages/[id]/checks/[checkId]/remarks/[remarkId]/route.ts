import { NextRequest, NextResponse } from 'next/server';
import { actorTypeFromAccess, clientIp, writeAudit } from '@/lib/audit';
import { handleApiError } from '@/lib/apiHelpers';
import { loadPackageForWrite } from '@/lib/acceptance/http';
import { isRemarkAction } from '@/lib/acceptance/rules';
import { editRemarkText, loadCheck, transitionRemark } from '@/lib/acceptance/store';

type Props = { params: Promise<{ id: string; checkId: string; remarkId: string }> };

/**
 * Смена состояния замечания (`action`: resolve | reopen | verify) или правка
 * текста открытого замечания (`text`). Снять замечание (`verify`) можно только
 * ссылкой на пройденную повторную проверку — `retestResultId`.
 *
 * Удаления нет намеренно: замечание — часть истории испытаний; ошибочное
 * замечание устраняется и проверяется с пояснением в повторной проверке.
 */
export async function PATCH(req: NextRequest, props: Props) {
  try {
    const { id, checkId, remarkId } = await props.params;
    const loaded = await loadPackageForWrite(req, id);
    if (loaded instanceof NextResponse) return loaded;
    const { pkg, access, actor } = loaded;
    const check = await loadCheck(pkg.id, checkId);
    if (!check) return NextResponse.json({ error: 'Проверка не найдена' }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    let result;
    let auditAction: string;
    if (body?.action !== undefined) {
      if (!isRemarkAction(body.action)) {
        return NextResponse.json(
          { error: 'Действие: resolve, reopen или verify' },
          { status: 400 },
        );
      }
      result = await transitionRemark({
        checkId: check.id,
        remarkId,
        action: body.action,
        retestResultId: typeof body.retestResultId === 'string' ? body.retestResultId : null,
        actor: actor.name,
      });
      auditAction = `acceptance_remark.${body.action}`;
    } else if (typeof body?.text === 'string') {
      const text = body.text.trim().slice(0, 4000);
      if (!text) return NextResponse.json({ error: 'Укажите текст замечания' }, { status: 400 });
      result = await editRemarkText({ checkId: check.id, remarkId, text });
      auditAction = 'acceptance_remark.edit';
    } else {
      return NextResponse.json({ error: 'Укажите action или text' }, { status: 400 });
    }
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    await writeAudit({
      actorType: actorTypeFromAccess(access.kind),
      actorId: actor.id,
      action: auditAction,
      entityType: 'gost_package',
      entityId: pkg.id,
      meta: {
        checkId: check.id,
        remarkId,
        status: result.value.status,
        retestResultId: result.value.retestResultId,
      },
      ip: clientIp(req),
    });

    return NextResponse.json({ remark: result.value });
  } catch (err) {
    return handleApiError(err, 'Failed to update acceptance remark', 500);
  }
}
