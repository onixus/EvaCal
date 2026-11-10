import { LlmProvider, getProviderApiKey } from './providers';

export const LLM_CHAT_TIMEOUT_MS = 30_000;
export const LLM_PROBE_TIMEOUT_MS = 2_500;

export interface LlmChatRequest {
  provider: LlmProvider;
  model: string;
  messages: Array<{ role: 'system' | 'user'; content: string }>;
  temperature: number;
  responseFormat?: 'json';
}

export interface LlmChatResult {
  text: string;
  model: string;
  providerId: string;
  latencyMs: number;
}

interface OllamaModelItem {
  name?: string;
  model?: string;
}

interface OpenAiModelItem {
  id?: string;
  name?: string;
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  ms: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  try {
    // redirect: 'error' — проверка endpointGuard делается по сконфигурированному URL,
    // редирект на другой хост её обошёл бы.
    const res = await fetch(url, { ...init, redirect: 'error', signal: controller.signal });
    clearTimeout(timeoutId);
    return res;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

export async function probeProvider(
  provider: LlmProvider,
): Promise<{ available: boolean; models: string[] }> {
  const cleanEndpoint = provider.endpoint.replace(/\/+$/, '');

  // 1. Try Ollama Native API (/api/tags)
  if (provider.kind === 'ollama') {
    try {
      const res = await fetchWithTimeout(
        `${cleanEndpoint}/api/tags`,
        { method: 'GET' },
        LLM_PROBE_TIMEOUT_MS,
      );
      if (res.ok) {
        const data = (await res.json()) as { models?: OllamaModelItem[] };
        const models = (data.models || [])
          .map((m) => m.name || m.model)
          .filter((name): name is string => typeof name === 'string' && name.length > 0);
        return { available: true, models };
      }
    } catch {
      // Ignore
    }
  }

  // 2. Try OpenAI-compatible / LM Studio API (/v1/models or /models)
  if (provider.kind === 'openai_compatible') {
    try {
      const modelsUrl = cleanEndpoint.endsWith('/v1')
        ? `${cleanEndpoint}/models`
        : `${cleanEndpoint}/v1/models`;

      const apiKey = getProviderApiKey(provider);
      const headers: Record<string, string> = {};
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const res = await fetchWithTimeout(
        modelsUrl,
        { method: 'GET', headers },
        LLM_PROBE_TIMEOUT_MS,
      );
      if (res.ok) {
        const data = (await res.json()) as { data?: OpenAiModelItem[] };
        const models = (data.data || [])
          .map((m) => m.id || m.name)
          .filter((name): name is string => typeof name === 'string' && name.length > 0);
        return { available: true, models };
      }
    } catch {
      // Both failed
    }
  }

  // 3. Try Google Gemini API (/v1beta/models)
  if (provider.kind === 'google') {
    try {
      const apiKey = getProviderApiKey(provider);
      const url = apiKey
        ? `${cleanEndpoint}/v1beta/models?key=${encodeURIComponent(apiKey)}`
        : `${cleanEndpoint}/v1beta/models`;

      const res = await fetchWithTimeout(url, { method: 'GET' }, LLM_PROBE_TIMEOUT_MS);
      if (res.ok) {
        const data = (await res.json()) as { models?: Array<{ name?: string }> };
        const models = (data.models || [])
          .map((m) => (m.name || '').replace(/^models\//, ''))
          .filter((name): name is string => typeof name === 'string' && name.length > 0);
        return { available: true, models };
      }
      // If endpoint is reachable or configured with default model
      if (provider.defaultModel) {
        return { available: true, models: [provider.defaultModel] };
      }
    } catch {
      if (provider.defaultModel) {
        return { available: true, models: [provider.defaultModel] };
      }
    }
  }

  return { available: false, models: [] };
}

export async function chatCompletion(req: LlmChatRequest): Promise<LlmChatResult> {
  const start = Date.now();
  const cleanEndpoint = req.provider.endpoint.replace(/\/+$/, '');
  const apiKey = getProviderApiKey(req.provider);

  if (req.provider.kind === 'openai_compatible') {
    const chatUrl = cleanEndpoint.endsWith('/v1')
      ? `${cleanEndpoint}/chat/completions`
      : `${cleanEndpoint}/v1/chat/completions`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const body: Record<string, any> = {
      model: req.model,
      messages: req.messages,
      temperature: req.temperature,
    };
    if (req.responseFormat === 'json') {
      // Some providers require this to enforce JSON output
      body.response_format = { type: 'json_object' };
    }

    const res = await fetchWithTimeout(
      chatUrl,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      },
      LLM_CHAT_TIMEOUT_MS,
    );

    if (!res.ok) {
      throw new Error(`OpenAI-compatible chat error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('Empty response from model');

    return {
      text,
      model: req.model,
      providerId: req.provider.id,
      latencyMs: Date.now() - start,
    };
  } else if (req.provider.kind === 'ollama') {
    // Translate standard messages to Ollama format
    const systemMsg = req.messages.find((m) => m.role === 'system')?.content || '';
    const userMsgs = req.messages
      .filter((m) => m.role === 'user')
      .map((m) => m.content)
      .join('\n\n');
    let prompt = userMsgs;
    if (systemMsg) {
      prompt = `${systemMsg}\n\n${userMsgs}`;
    }
    if (req.responseFormat === 'json') {
      prompt = `${prompt}\n\nJSON-ответ:`;
    }

    const body: Record<string, any> = {
      model: req.model,
      prompt,
      stream: false,
      options: {
        temperature: req.temperature,
      },
    };
    if (req.responseFormat === 'json') {
      body.format = 'json';
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const res = await fetchWithTimeout(
      `${cleanEndpoint}/api/generate`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      },
      LLM_CHAT_TIMEOUT_MS,
    );

    if (!res.ok) {
      throw new Error(`Ollama chat error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const text = data.response?.trim();
    if (!text) throw new Error('Empty response from model');

    return {
      text,
      model: req.model,
      providerId: req.provider.id,
      latencyMs: Date.now() - start,
    };
  } else if (req.provider.kind === 'google') {
    // Google Gemini REST API (v1beta)
    // Model identifier may be 'gemini-2.5-flash', format: /v1beta/models/{model}:generateContent
    const cleanModel = req.model.replace(/^models\//, '');
    const generateUrl = apiKey
      ? `${cleanEndpoint}/v1beta/models/${encodeURIComponent(cleanModel)}:generateContent?key=${encodeURIComponent(apiKey)}`
      : `${cleanEndpoint}/v1beta/models/${encodeURIComponent(cleanModel)}:generateContent`;

    // Map system and user messages to Google's contents / systemInstruction format
    const systemMsg = req.messages.find((m) => m.role === 'system')?.content || '';
    const userMsgs = req.messages
      .filter((m) => m.role === 'user')
      .map((m) => ({
        role: 'user',
        parts: [{ text: m.content }],
      }));

    const body: Record<string, any> = {
      contents: userMsgs,
      generationConfig: {
        temperature: req.temperature,
      },
    };

    if (systemMsg) {
      body.systemInstruction = {
        parts: [{ text: systemMsg }],
      };
    }

    if (req.responseFormat === 'json') {
      body.generationConfig.responseMimeType = 'application/json';
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    const res = await fetchWithTimeout(
      generateUrl,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      },
      LLM_CHAT_TIMEOUT_MS,
    );

    if (!res.ok) {
      throw new Error(`Google Gemini chat error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts
      ?.map((p: any) => p.text || '')
      .join('')
      .trim();
    if (!text) throw new Error('Empty response from Google Gemini model');

    return {
      text,
      model: req.model,
      providerId: req.provider.id,
      latencyMs: Date.now() - start,
    };
  }

  throw new Error(`Unsupported provider kind: ${(req.provider as any).kind}`);
}

export function extractJsonValue(text: string): unknown {
  const jsonMatch = text.match(/\[\s*\{[\s\S]*\}\s*\]|\{\s*"[\s\S]*\}\s*/);
  const jsonString = jsonMatch ? jsonMatch[0] : text;
  return JSON.parse(jsonString);
}
