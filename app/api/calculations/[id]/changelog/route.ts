import { NextRequest, NextResponse } from 'next/server';
import { requireCalcAccess } from '@/lib/access';
import { handleApiError } from '@/lib/apiHelpers';
import { listInternalChanges, recordInternalChange, type ChangeSource } from '@/lib/changelog';
import { CHANGE_SOURCE_LABELS } from '@/lib/changelog';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const params = await props.params;
    const access = await requireCalcAccess(req, params.id, ['read']);
    if (access instanceof NextResponse) return access;

    return NextResponse.json({ changes: await listInternalChanges(params.id) });
  } catch (err) {
    return handleApiError(err, 'Failed to load internal changes', 500);
  }
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const params = await props.params;
    // Лист — часть комплекта, а не журнал наблюдателя: писать в него может
    // только тот, кто вправе править расчёт.
    const access = await requireCalcAccess(req, params.id, ['write']);
    if (access instanceof NextResponse) return access;

    const body = await req.json();
    const docRef = String(body?.docRef ?? '').trim();
    const text = String(body?.text ?? '').trim();
    const source = String(body?.source ?? '') as ChangeSource;

    if (!docRef || !text) {
      return NextResponse.json(
        { error: 'Поля «Документ · раздел» и «Изменение» обязательны' },
        { status: 400 },
      );
    }
    if (!(source in CHANGE_SOURCE_LABELS)) {
      return NextResponse.json({ error: 'Неизвестный источник изменения' }, { status: 400 });
    }

    const actor =
      access.kind === 'staff' ? (access.session?.username ?? 'staff') : (access.actorId ?? 'share');
    const role = access.kind === 'staff' ? (access.session?.role ?? 'architect') : 'presale';

    const created = await recordInternalChange({
      calculationId: params.id,
      author: actor,
      role,
      docRef,
      text,
      source,
      packageId: body?.packageId ? String(body.packageId) : null,
    });

    return NextResponse.json({ id: created.id, seq: created.seq }, { status: 201 });
  } catch (err) {
    return handleApiError(err, 'Failed to record internal change', 500);
  }
}
