import { NextRequest, NextResponse } from 'next/server';
import {
  actorOf,
  auditKit,
  badVersion,
  failure,
  parseVersionParam,
  requireKitLibrary,
} from '@/lib/solutionKits/http';
import { archiveVersion } from '@/lib/solutionKits/store';

type Params = { params: Promise<{ kitId: string; version: string }> };

/** Перевод утверждённой версии в архив (содержимое не меняется). */
export async function POST(req: NextRequest, props: Params) {
  const auth = await requireKitLibrary();
  if (auth instanceof NextResponse) return auth;
  const { kitId, version: raw } = await props.params;
  const version = parseVersionParam(raw);
  if (!version) return badVersion();
  const result = await archiveVersion(actorOf(auth), kitId, version);
  if (!result.ok) return failure(result);
  await auditKit(req, auth, 'version.archive', kitId, { version });
  return NextResponse.json({ version: result.version, status: 'archived' });
}
