import { NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { getDefaultLlmProviderId, listPublicLlmProviders } from '@/lib/gost34/llm/providers';
import { GOST34_LLM_ROLES } from '../roles';

/** Lists the providers the server is willing to talk to — ids and labels only. */
export async function GET() {
  const session = await requireApiRole(GOST34_LLM_ROLES);
  if (session instanceof NextResponse) return session;

  return NextResponse.json({
    providers: listPublicLlmProviders(),
    defaultProviderId: getDefaultLlmProviderId() ?? null,
  });
}
