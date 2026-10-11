import { NextRequest, NextResponse } from 'next/server';
import { actorOf, auditKit, failure, readJson, requireKitLibrary } from '@/lib/solutionKits/http';
import { getKit, updateKitPassport } from '@/lib/solutionKits/store';

type Params = { params: Promise<{ kitId: string }> };

/** Паспорт набора и список версий (без содержимого). */
export async function GET(_req: NextRequest, props: Params) {
  const auth = await requireKitLibrary();
  if (auth instanceof NextResponse) return auth;
  const { kitId } = await props.params;
  const kit = await getKit(kitId);
  if (!kit) return NextResponse.json({ error: 'Набор не найден' }, { status: 404 });
  return NextResponse.json({ kit });
}

/**
 * Паспорт: `{ name?, scope?, source?, ownerId?, status?: 'archived' | 'active' }`.
 * Только admin или владелец набора с ролью architect.
 */
export async function PATCH(req: NextRequest, props: Params) {
  const auth = await requireKitLibrary();
  if (auth instanceof NextResponse) return auth;
  const { kitId } = await props.params;
  const body = await readJson(req);
  if (body instanceof NextResponse) return body;
  const result = await updateKitPassport(actorOf(auth), kitId, body);
  if (!result.ok) return failure(result);
  await auditKit(req, auth, 'update', kitId, { fields: Object.keys(body) });
  return NextResponse.json({ kit: result.kit });
}
