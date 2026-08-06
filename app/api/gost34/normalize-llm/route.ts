import { NextRequest, NextResponse } from 'next/server';
import { normalizeRequirementsWithLlm } from '@/lib/gost34/parser/llmNormalizer';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { requirements = [], provider, endpoint, model, apiKey, temperature } = body;

    if (!Array.isArray(requirements) || requirements.length === 0) {
      return NextResponse.json({ error: 'Requirements array is empty' }, { status: 400 });
    }

    const result = await normalizeRequirementsWithLlm(requirements, {
      provider,
      endpoint,
      model,
      apiKey,
      temperature,
    });

    return NextResponse.json({
      requirements: result.requirements,
      usedLlm: result.usedLlm,
      modelUsed: result.modelUsed,
      providerUsed: result.providerUsed,
    });
  } catch (err: any) {
    console.error('Error in LLM normalization endpoint:', err);
    return NextResponse.json({ error: err?.message || 'Normalization failed' }, { status: 500 });
  }
}
