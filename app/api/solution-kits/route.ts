import { NextRequest, NextResponse } from 'next/server';
import { actorOf, auditKit, failure, readJson, requireKitLibrary } from '@/lib/solutionKits/http';
import { createKit, listKits } from '@/lib/solutionKits/store';

/** Библиотека решений (#103 WP-7a): список наборов. Доступ — architect, admin. */
export async function GET() {
  const auth = await requireKitLibrary();
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ kits: await listKits() });
}

/**
 * Новый набор: `{ key, name, scope?, source?, content?, changelog? }`.
 * Создатель становится владельцем; создаётся черновик версии 1.
 */
export async function POST(req: NextRequest) {
  const auth = await requireKitLibrary();
  if (auth instanceof NextResponse) return auth;
  const body = await readJson(req);
  if (!body) return NextResponse.json({ error: 'Ожидается JSON-объект' }, { status: 400 });
  const result = await createKit(actorOf(auth), body);
  if (!result.ok) return failure(result);
  await auditKit(req, auth, 'create', result.kit.id, { key: result.kit.key });
  return NextResponse.json({ kit: result.kit, issues: result.issues }, { status: 201 });
}
