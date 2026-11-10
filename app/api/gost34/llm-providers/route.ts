import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import {
  LlmRolePurpose,
  getDefaultLlmProviderId,
  listPublicLlmProviders,
} from '@/lib/gost34/llm/providers';
import { GOST34_LLM_ROLES } from '../roles';

/** Lists the providers the server is willing to talk to — ids and labels only. */
export async function GET(req: NextRequest) {
  const session = await requireApiRole(GOST34_LLM_ROLES);
  if (session instanceof NextResponse) return session;

  const url = new URL(req.url);
  const purposeParam = url.searchParams.get('purpose') as LlmRolePurpose | null;
  const purpose: LlmRolePurpose =
    purposeParam === 'review' || purposeParam === 'drafting' || purposeParam === 'general'
      ? purposeParam
      : 'drafting';

  return NextResponse.json({
    providers: listPublicLlmProviders(),
    defaultProviderId: getDefaultLlmProviderId(purpose) ?? null,
  });
}
