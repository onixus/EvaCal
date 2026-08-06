import { NextRequest, NextResponse } from 'next/server';
import { checkLocalLlmAvailability } from '@/lib/gost34/parser/llmNormalizer';

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const endpoint = searchParams.get('endpoint') || process.env.OLLAMA_HOST || 'http://localhost:11434';
  const provider = (searchParams.get('provider') || 'ollama') as 'ollama' | 'openai_compatible';

  const status = await checkLocalLlmAvailability(endpoint, provider);

  return NextResponse.json({
    endpoint,
    provider: status.provider,
    available: status.available,
    models: status.models,
  });
}
