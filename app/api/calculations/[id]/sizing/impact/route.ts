import { NextRequest, NextResponse } from 'next/server';
import { requireCalcAccess } from '@/lib/access';
import { previewSizingImpact } from '@/lib/sizing/service';
import { canEditSizingProfiles, sizingError } from '@/lib/sizing/http';

export const dynamic = 'force-dynamic';
type Params = { params: Promise<{ id: string }> };

/**
 * Предпросмотр влияния сайзинга на спецификацию (ничего не сохраняет).
 * Тело: { runId } или { profileVersionId, inputs }, необязательно selections.
 */
export async function POST(req: NextRequest, props: Params) {
  try {
    const { id } = await props.params;
    const access = await requireCalcAccess(req, id, ['read']);
    if (access instanceof NextResponse) return access;
    const preview = await previewSizingImpact(id, await req.json(), {
      allowDraft: canEditSizingProfiles(access),
    });
    return NextResponse.json(preview, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return sizingError(error, 'Не удалось рассчитать влияние сайзинга');
  }
}
