import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireCalcAccess } from '@/lib/access';
import { handleApiError } from '@/lib/apiHelpers';
import {
  parseChecklist,
  parseComments,
  type ChecklistItem,
  type CommentSeverity,
  type SectionComment,
} from '@/lib/gost34/review/types';

const SEVERITIES: CommentSeverity[] = ['blocker', 'remark', 'suggestion'];

/**
 * Черновое состояние ревью: отметки чек-листа и комментарии по разделам.
 *
 * Пишется по мере работы ревьювера, до вынесения вердикта — иначе закрытая
 * вкладка стоила бы часа нормоконтроля.
 */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const params = await props.params;
    const pkg = await prisma.gostPackage.findUnique({ where: { id: params.id } });
    if (!pkg) return NextResponse.json({ error: 'Пакет документов не найден' }, { status: 404 });

    const access = await requireCalcAccess(req, pkg.calculationId, ['review']);
    if (access instanceof NextResponse) return access;

    if (pkg.status === 'approved') {
      return NextResponse.json({ error: 'Утверждённый комплект неизменяем' }, { status: 409 });
    }

    const body = await req.json();
    const data: { reviewChecklist?: string; reviewComments?: string } = {};

    if (Array.isArray(body?.checklist)) {
      // Пишем только то, что относится к известным пунктам: клиент не должен
      // уметь завести произвольный пункт чек-листа через этот роут.
      const known = parseChecklist(null).map((i) => i.id);
      const cleaned: Pick<ChecklistItem, 'id' | 'state' | 'note'>[] = body.checklist
        .filter((item: ChecklistItem) => known.includes(item?.id))
        .map((item: ChecklistItem) => ({
          id: item.id,
          state: ['ok', 'block', 'warn', 'empty'].includes(item.state) ? item.state : 'empty',
          note: String(item.note ?? '').slice(0, 500),
        }));
      data.reviewChecklist = JSON.stringify(cleaned);
    }

    if (Array.isArray(body?.comments)) {
      const actor =
        access.kind === 'staff' ? (access.session?.username ?? 'reviewer') : access.actorId;

      const cleaned: SectionComment[] = body.comments
        .filter((c: SectionComment) => c?.sectionId && String(c?.text ?? '').trim())
        .map((c: SectionComment, idx: number) => ({
          id: c.id || `c${idx}-${Date.now()}`,
          sectionId: String(c.sectionId).slice(0, 200),
          severity: SEVERITIES.includes(c.severity) ? c.severity : 'remark',
          text: String(c.text).trim().slice(0, 2000),
          // Автора проставляет сервер: подписать чужим именем нельзя.
          author: c.author || actor,
          createdAt: c.createdAt || new Date().toISOString(),
        }));
      data.reviewComments = JSON.stringify(cleaned);
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Нечего сохранять' }, { status: 400 });
    }

    const updated = await prisma.gostPackage.update({ where: { id: pkg.id }, data });

    return NextResponse.json({
      checklist: parseChecklist(updated.reviewChecklist),
      comments: parseComments(updated.reviewComments),
    });
  } catch (err) {
    return handleApiError(err, 'Failed to save review state', 500);
  }
}
