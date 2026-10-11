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
import { approveVersion, parseExpectedUpdatedAt } from '@/lib/solutionKits/store';

type Params = { params: Promise<{ kitId: string; version: string }> };

/**
 * Утверждение черновика. Только admin или владелец набора с ролью architect;
 * содержимое без замечаний целостности (иначе 409 с `issues`).
 * Тело `{ expectedUpdatedAt }` — `updatedAt` просмотренного черновика: если
 * черновик с тех пор изменили, 409.
 */
export async function POST(req: NextRequest, props: Params) {
  const auth = await requireKitLibrary();
  if (auth instanceof NextResponse) return auth;
  const { kitId, version: raw } = await props.params;
  const version = parseVersionParam(raw);
  if (!version) return badVersion();
  const body = await readJson(req);
  if (body instanceof NextResponse) return body;
  const expectedUpdatedAt = parseExpectedUpdatedAt(body.expectedUpdatedAt);
  if (!expectedUpdatedAt) {
    return NextResponse.json(
      { error: 'expectedUpdatedAt: updatedAt просмотренного черновика (ISO)' },
      { status: 400 },
    );
  }
  const result = await approveVersion(actorOf(auth), kitId, version, expectedUpdatedAt);
  if (!result.ok) return failure(result);
  await auditKit(req, auth, 'version.approve', kitId, { version });
  return NextResponse.json({ version: result.version, status: 'approved' });
}
