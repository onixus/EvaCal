import { NextRequest, NextResponse } from 'next/server';
import { requireCalcAccess } from '@/lib/access';
import { actorTypeFromAccess, clientIp, writeAudit } from '@/lib/audit';
import { createManualRun, createProfileRun, listProfiles, listRuns } from '@/lib/sizing/store';
import { canEditSizingProfiles, canWriteCalculation, sizingError } from '@/lib/sizing/http';

export const dynamic = 'force-dynamic';
type Params = { params: Promise<{ id: string }> };

/** Прогоны расчета и доступные версии профилей (тот же доступ, что у спецификации). */
export async function GET(req: NextRequest, props: Params) {
  try {
    const { id } = await props.params;
    const access = await requireCalcAccess(req, id, ['read']);
    if (access instanceof NextResponse) return access;
    const editor = canEditSizingProfiles(access);
    const profiles = (await listProfiles()).map((p) => ({
      ...p,
      // Черновики профилей видят только редакторы профилей.
      versions: p.versions.filter(
        (v) => v.status === 'approved' || (editor && v.status === 'draft'),
      ),
    }));
    return NextResponse.json(
      {
        runs: await listRuns(id),
        profiles,
        canWrite: canWriteCalculation(access),
        canEditProfiles: editor,
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return sizingError(error, 'Не удалось загрузить сайзинг');
  }
}

/** Новый прогон: по утвержденной версии профиля или ручной (source: 'manual'). */
export async function POST(req: NextRequest, props: Params) {
  try {
    const { id } = await props.params;
    const access = await requireCalcAccess(req, id, ['write']);
    if (access instanceof NextResponse) return access;
    const body = await req.json();
    const run =
      body?.source === 'manual'
        ? await createManualRun(id, body, access.actorId)
        : await createProfileRun(id, body, access.actorId);
    await writeAudit({
      actorType: actorTypeFromAccess(access.kind),
      actorId: access.actorId,
      action: 'sizing.run.create',
      entityType: 'calculation',
      entityId: id,
      meta: { runId: run.id, source: run.source, profileVersionId: run.profileVersionId },
      ip: clientIp(req),
    });
    return NextResponse.json(run, { status: 201 });
  } catch (error) {
    return sizingError(error, 'Не удалось сохранить прогон сайзинга');
  }
}
