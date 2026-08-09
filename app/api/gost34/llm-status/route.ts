import { NextRequest, NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth";
import { checkLocalLlmAvailability } from "@/lib/gost34/parser/llmNormalizer";
import { EndpointNotAllowedError } from "@/lib/gost34/llm/endpointGuard";
import { resolveLlmProvider } from "@/lib/gost34/llm/providers";
import { GOST34_LLM_ROLES } from "../roles";

export async function GET(req: NextRequest) {
  const session = await requireApiRole(GOST34_LLM_ROLES);
  if (session instanceof NextResponse) return session;

  // The caller names a provider; it never supplies a URL.
  const providerId = req.nextUrl.searchParams.get("providerId") || undefined;

  let provider;
  try {
    provider = resolveLlmProvider(providerId);
  } catch (e) {
    if (e instanceof EndpointNotAllowedError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }

  const status = await checkLocalLlmAvailability(
    provider.endpoint,
    provider.kind,
  );

  // Note: the endpoint is deliberately absent from the response.
  return NextResponse.json({
    providerId: provider.id,
    label: provider.label,
    provider: status.provider,
    available: status.available,
    models: status.models,
  });
}
