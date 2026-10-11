import { NextRequest, NextResponse } from 'next/server';
import {
  actorOf,
  auditKit,
  badVersion,
  failure,
  parseVersionParam,
  requireKitLibrary,
} from '@/lib/solutionKits/http';
import { approveVersion } from '@/lib/solutionKits/store';

type Params = { params: Promise<{ kitId: string; version: string }> };

/**
 * Утверждение черновика. Только admin или владелец набора с ролью architect;
 * содержимое без замечаний целостности (иначе 409 с `issues`).
 */
export async function POST(req: NextRequest, props: Params) {
  const auth = await requireKitLibrary();
  if (auth instanceof NextResponse) return auth;
  const { kitId, version: raw } = await props.params;
  const version = parseVersionParam(raw);
  if (!version) return badVersion();
  const result = await approveVersion(actorOf(auth), kitId, version);
  if (!result.ok) return failure(result);
  await auditKit(req, auth, 'version.approve', kitId, { version });
  return NextResponse.json({ version: result.version, status: 'approved' });
}
