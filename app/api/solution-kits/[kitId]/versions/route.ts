import { NextRequest, NextResponse } from 'next/server';
import { actorOf, auditKit, failure, requireKitLibrary } from '@/lib/solutionKits/http';
import { createDraftVersion } from '@/lib/solutionKits/store';

type Params = { params: Promise<{ kitId: string }> };

/** Новый черновик версии — копия последней версии набора (номер max + 1). */
export async function POST(req: NextRequest, props: Params) {
  const auth = await requireKitLibrary();
  if (auth instanceof NextResponse) return auth;
  const { kitId } = await props.params;
  const result = await createDraftVersion(actorOf(auth), kitId);
  if (!result.ok) return failure(result);
  await auditKit(req, auth, 'version.create', kitId, { version: result.version.version });
  return NextResponse.json({ version: result.version }, { status: 201 });
}
