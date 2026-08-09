import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth';
import { normalizeRequirementsWithLlm } from '@/lib/gost34/parser/llmNormalizer';
import { EndpointNotAllowedError } from '@/lib/gost34/llm/endpointGuard';
import { resolveLlmProvider } from '@/lib/gost34/llm/providers';
import { validateRequirements } from '@/lib/gost34/validation';
import { GOST34_LLM_ROLES } from '../roles';

export async function POST(req: NextRequest) {
  const session = await requireApiRole(GOST34_LLM_ROLES);
  if (session instanceof NextResponse) return session;

  try {
    const body = await req.json();
    // `endpoint` and `apiKey` are intentionally NOT read from the body.
    const { requirements = [], providerId, model, temperature } = body;

    if (!Array.isArray(requirements) || requirements.length === 0) {
      return NextResponse.json({ error: 'Requirements array is empty' }, { status: 400 });
    }

    let provider;
    try {
      provider = resolveLlmProvider(providerId);
    } catch (e) {
      if (e instanceof EndpointNotAllowedError) {
        return NextResponse.json({ error: e.message }, { status: 400 });
      }
      throw e;
    }

    const result = await normalizeRequirementsWithLlm(requirements, {
      provider,
      model,
      temperature,
    });

    return NextResponse.json({
      requirements: result.requirements,
      requirementsV2: result.requirementsV2,
      validation: validateRequirements(result.requirementsV2),
      usedLlm: result.usedLlm,
      modelUsed: result.modelUsed,
      providerUsed: result.providerUsed,
    });
  } catch (err: any) {
    console.error('Error in LLM normalization endpoint:', err);
    return NextResponse.json({ error: err?.message || 'Normalization failed' }, { status: 500 });
  }
}
