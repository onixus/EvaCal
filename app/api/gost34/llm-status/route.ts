import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { probeProvider } from '@/lib/gost34/llm/client';
import { isTzAuthorEnabled } from '@/lib/gost34/llm/tzAuthor/flag';
import { EndpointNotAllowedError } from '@/lib/gost34/llm/endpointGuard';
import { resolveLlmProvider } from '@/lib/gost34/llm/providers';
import { GOST34_LLM_ROLES } from '../roles';

export async function GET(req: NextRequest) {
  const session = await requireApiRole(GOST34_LLM_ROLES);
  if (session instanceof NextResponse) return session;

  const tzAuthorEnabled = isTzAuthorEnabled();
  const providerId = req.nextUrl.searchParams.get('providerId') || undefined;

  let provider;
  try {
    provider = resolveLlmProvider(providerId);
  } catch (e) {
    const errorMsg =
      e instanceof EndpointNotAllowedError
        ? e.message
        : e instanceof Error
          ? e.message
          : 'Unknown error';
    return NextResponse.json({
      error: errorMsg,
      available: false,
      tzAuthorEnabled,
    });
  }

  const status = await probeProvider(provider);

  // Note: the endpoint is deliberately absent from the response.
  return NextResponse.json({
    providerId: provider.id,
    label: provider.label,
    available: status.available,
    models: status.models,
    tzAuthorEnabled,
  });
}
