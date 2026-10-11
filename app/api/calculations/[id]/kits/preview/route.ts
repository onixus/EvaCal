import { NextRequest, NextResponse } from 'next/server';
import {
  kitFailure,
  kitTarget,
  readJson,
  requireKitApplicationRole,
} from '@/lib/kitApplication/http';
import { parseSelection } from '@/lib/kitApplication/plan';
import { previewKitApplication } from '@/lib/kitApplication/store';

type Params = { params: Promise<{ id: string }> };

/** План применения без записи: `{ kitId, version?, selection }`. */
export async function POST(req: NextRequest, props: Params) {
  const auth = await requireKitApplicationRole();
  if (auth instanceof NextResponse) return auth;
  const { id } = await props.params;
  const body = await readJson(req);
  if (body instanceof NextResponse) return body;
  const target = kitTarget(body);
  if (target instanceof NextResponse) return target;
  const selection = parseSelection(body.selection);
  if (typeof selection === 'string') {
    return NextResponse.json({ error: selection }, { status: 400 });
  }
  const result = await previewKitApplication({ calculationId: id, ...target, selection });
  if (!result.ok) return kitFailure(result);
  return NextResponse.json({ plan: result.plan, kit: result.kit, content: result.content });
}
