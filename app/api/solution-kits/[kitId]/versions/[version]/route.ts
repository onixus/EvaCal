import { NextRequest, NextResponse } from 'next/server';
import {
  actorOf,
  auditKit,
  badVersion,
  failure,
  parseVersionParam,
  readJson,
  requireKitLibrary,
} from '@/lib/solutionKits/http';
import { deleteDraftVersion, getKitVersion, updateDraftVersion } from '@/lib/solutionKits/store';

type Params = { params: Promise<{ kitId: string; version: string }> };

/** Содержимое версии, сводка по разделам и замечания целостности. */
export async function GET(_req: NextRequest, props: Params) {
  const auth = await requireKitLibrary();
  if (auth instanceof NextResponse) return auth;
  const { kitId, version: raw } = await props.params;
  const version = parseVersionParam(raw);
  if (!version) return badVersion();
  const row = await getKitVersion(kitId, version);
  if (!row) return NextResponse.json({ error: 'Версия не найдена' }, { status: 404 });
  return NextResponse.json({ version: row });
}

/**
 * Правка черновика: `{ content?, changelog? }`. Форма содержимого обязательна
 * (400 с `issues`); замечания целостности возвращаются, но не мешают сохранить.
 */
export async function PATCH(req: NextRequest, props: Params) {
  const auth = await requireKitLibrary();
  if (auth instanceof NextResponse) return auth;
  const { kitId, version: raw } = await props.params;
  const version = parseVersionParam(raw);
  if (!version) return badVersion();
  const body = await readJson(req);
  if (!body) return NextResponse.json({ error: 'Ожидается JSON-объект' }, { status: 400 });
  const result = await updateDraftVersion(actorOf(auth), kitId, version, body);
  if (!result.ok) return failure(result);
  await auditKit(req, auth, 'version.update', kitId, {
    version,
    fields: Object.keys(body).filter((k) => k === 'content' || k === 'changelog'),
  });
  return NextResponse.json({ issues: result.issues });
}

/** Удаление черновика (утверждённые версии не удаляются — триггер в БД). */
export async function DELETE(req: NextRequest, props: Params) {
  const auth = await requireKitLibrary();
  if (auth instanceof NextResponse) return auth;
  const { kitId, version: raw } = await props.params;
  const version = parseVersionParam(raw);
  if (!version) return badVersion();
  const result = await deleteDraftVersion(actorOf(auth), kitId, version);
  if (!result.ok) return failure(result);
  await auditKit(req, auth, 'version.delete', kitId, { version });
  return NextResponse.json({ ok: true });
}
