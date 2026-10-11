import { NextRequest, NextResponse } from 'next/server';
import { badVersion, failure, parseVersionParam, requireKitLibrary } from '@/lib/solutionKits/http';
import { diffKitVersion } from '@/lib/solutionKits/store';

type Params = { params: Promise<{ kitId: string; version: string }> };

/** Разница с `?against=N` или, по умолчанию, с предыдущей версией. */
export async function GET(req: NextRequest, props: Params) {
  const auth = await requireKitLibrary();
  if (auth instanceof NextResponse) return auth;
  const { kitId, version: raw } = await props.params;
  const version = parseVersionParam(raw);
  if (!version) return badVersion();
  const againstRaw = req.nextUrl.searchParams.get('against');
  let against: number | undefined;
  if (againstRaw !== null) {
    const parsed = parseVersionParam(againstRaw);
    if (!parsed) return badVersion();
    against = parsed;
  }
  const result = await diffKitVersion(kitId, version, against);
  if (!result.ok) return failure(result);
  return NextResponse.json({ diff: result.diff });
}
