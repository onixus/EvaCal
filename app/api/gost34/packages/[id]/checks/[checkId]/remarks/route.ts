import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { actorTypeFromAccess, clientIp, writeAudit } from '@/lib/audit';
import { handleApiError } from '@/lib/apiHelpers';
import { loadPackageForRead, loadPackageForWrite } from '@/lib/acceptance/http';
import { createRemark, loadCheck } from '@/lib/acceptance/store';

type Props = { params: Promise<{ id: string; checkId: string }> };

/** Замечания проверки со всеми состояниями (история не удаляется). */
export async function GET(req: NextRequest, props: Props) {
  try {
    const { id, checkId } = await props.params;
    const loaded = await loadPackageForRead(req, id);
    if (loaded instanceof NextResponse) return loaded;
    const check = await loadCheck(loaded.pkg.id, checkId);
    if (!check) return NextResponse.json({ error: 'Проверка не найдена' }, { status: 404 });
    return NextResponse.json({ remarks: check.remarks });
  } catch (err) {
    return handleApiError(err, 'Failed to load acceptance remarks', 500);
  }
}

/** Новое замечание к проверке, при желании — к конкретному результату. */
export async function POST(req: NextRequest, props: Props) {
  try {
    const { id, checkId } = await props.params;
    const loaded = await loadPackageForWrite(req, id);
    if (loaded instanceof NextResponse) return loaded;
    const { pkg, access, actor } = loaded;
    const check = await loadCheck(pkg.id, checkId);
    if (!check) return NextResponse.json({ error: 'Проверка не найдена' }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const text = String(body?.text ?? '')
      .trim()
      .slice(0, 4000);
    if (!text) return NextResponse.json({ error: 'Укажите текст замечания' }, { status: 400 });

    let resultId: string | null = null;
    if (typeof body?.resultId === 'string' && body.resultId) {
      const result = await prisma.acceptanceResult.findFirst({
        where: { id: body.resultId, checkId: check.id },
        select: { id: true },
      });
      if (!result) {
        return NextResponse.json({ error: 'Результат этой проверки не найден' }, { status: 400 });
      }
      resultId = result.id;
    }

    const remark = await createRemark({
      checkId: check.id,
      resultId,
      text,
      createdBy: actor.name,
      createdById: actor.id,
    });

    await writeAudit({
      actorType: actorTypeFromAccess(access.kind),
      actorId: actor.id,
      action: 'acceptance_remark.create',
      entityType: 'gost_package',
      entityId: pkg.id,
      meta: { checkId: check.id, remarkId: remark.id, resultId },
      ip: clientIp(req),
    });

    return NextResponse.json({ remark }, { status: 201 });
  } catch (err) {
    return handleApiError(err, 'Failed to create acceptance remark', 500);
  }
}
