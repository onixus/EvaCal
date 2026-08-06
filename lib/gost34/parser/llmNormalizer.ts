import { Gost34RequirementItem } from '../types';
import { normalizeRequirementItems } from './requirementSanitizer';

export interface LlmNormalizerOptions {
  provider?: 'ollama' | 'openai_compatible'; // Default: 'ollama'
  endpoint?: string; // Default: http://localhost:11434 or http://localhost:1234/v1
  model?: string; // Default: llama3.2, qwen2.5, mistral, deepseek-r1
  apiKey?: string;
  temperature?: number;
  fallbackToRules?: boolean;
}

/**
 * Checks availability of Ollama or LM Studio / OpenAI-compatible endpoint.
 */
export async function checkLocalLlmAvailability(
  endpoint: string = 'http://localhost:11434',
  provider: 'ollama' | 'openai_compatible' = 'ollama'
): Promise<{ available: boolean; provider: string; models: string[] }> {
  const cleanEndpoint = endpoint.replace(/\/+$/, '');

  // 1. Try Ollama Native API (/api/tags)
  if (provider === 'ollama' || !provider) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);

      const res = await fetch(`${cleanEndpoint}/api/tags`, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        const models = (data.models || []).map((m: any) => m.name || m.model);
        return { available: true, provider: 'ollama', models };
      }
    } catch (e) {
      // Ignore and try OpenAI / LM Studio endpoint
    }
  }

  // 2. Try OpenAI-compatible / LM Studio API (/v1/models or /models)
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);

    const modelsUrl = cleanEndpoint.endsWith('/v1') ? `${cleanEndpoint}/models` : `${cleanEndpoint}/v1/models`;

    const res = await fetch(modelsUrl, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      const models = (data.data || []).map((m: any) => m.id || m.name);
      return { available: true, provider: 'openai_compatible', models };
    }
  } catch (e) {
    // Both failed
  }

  return { available: false, provider, models: [] };
}

/**
 * Normalizes raw unstructured requirement text using Ollama or LM Studio / OpenAI API.
 */
export async function normalizeRequirementsWithLlm(
  rawItems: Gost34RequirementItem[],
  options: LlmNormalizerOptions = {}
): Promise<{ requirements: Gost34RequirementItem[]; usedLlm: boolean; modelUsed?: string; providerUsed?: string }> {
  const provider = options.provider || 'ollama';
  const defaultEndpoint = provider === 'ollama' ? 'http://localhost:11434' : 'http://localhost:1234/v1';
  const endpoint = (options.endpoint || process.env.OLLAMA_HOST || defaultEndpoint).replace(/\/+$/, '');
  const fallbackToRules = options.fallbackToRules !== false;

  // 1. Check availability
  const { available, models, provider: detectedProvider } = await checkLocalLlmAvailability(endpoint, provider);

  if (!available) {
    if (fallbackToRules) {
      return {
        requirements: normalizeRequirementItems(rawItems),
        usedLlm: false,
      };
    } else {
      throw new Error(`ИИ-сервер недоступен по адресу ${endpoint}. Запустите Ollama или LM Studio.`);
    }
  }

  const preferredModels = ['qwen2.5', 'llama3.2', 'llama3', 'mistral', 'deepseek-r1', 'gemma2', 'local-model'];
  let targetModel = options.model;

  if (!targetModel) {
    targetModel = models.find((m) => preferredModels.some((pref) => m.toLowerCase().includes(pref))) || models[0] || 'llama3.2';
  }

  const systemPrompt = `Ты — ведущий системный архитектор и специалист по ГОСТ 34.602-89.
Твоя задача — преобразовать неструктурированные требования вендора в четкую профессиональную структуру ГОСТ 34.

Требования к ответу:
1. Выдай ответ СТРОГО в формате JSON-массива объектов без какого-либо лидирующего или замыкающего текста.
2. Каждое требование должно иметь следующие поля:
   - "code": стандартный код пункта (например "ТР-ФУНК-01", "ТР-БЕЗ-01", "ТР-НАД-01", "ТР-ТЕХ-01")
   - "category": одна из категорий: "functional", "security", "reliability", "performance", "ergonomics", "technical"
   - "title": краткое профессиональное наименование требования по ГОСТ 34
   - "description": полный юридически точный текст требования в стандартной формулировке ("Система должна обеспечивать...")

Формат JSON:
[
  {
    "code": "ТР-ФУНК-01",
    "category": "functional",
    "title": "Авторизация пользователей",
    "description": "Система должна обеспечивать аутентификацию пользователей по паролю и двухфакторному коду."
  }
]`;

  const userContent = JSON.stringify(
    rawItems.map((item) => ({
      code: item.code,
      title: item.title,
      description: item.description,
    })),
    null,
    2
  );

  // 2. Request via LM Studio / OpenAI Chat Completions API
  if (detectedProvider === 'openai_compatible' || provider === 'openai_compatible') {
    try {
      const chatUrl = endpoint.endsWith('/v1') ? `${endpoint}/chat/completions` : `${endpoint}/v1/chat/completions`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (options.apiKey) {
        headers['Authorization'] = `Bearer ${options.apiKey}`;
      }

      const res = await fetch(chatUrl, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          model: targetModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Исходные требования вендора для нормализации:\n${userContent}` },
          ],
          temperature: options.temperature ?? 0.2,
        }),
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        const responseText = data.choices?.[0]?.message?.content?.trim();

        if (responseText) {
          const jsonMatch = responseText.match(/\[\s*\{[\s\S]*\}\s*\]/);
          const jsonString = jsonMatch ? jsonMatch[0] : responseText;
          const parsedJson = JSON.parse(jsonString);

          if (Array.isArray(parsedJson) && parsedJson.length > 0) {
            const llmRequirements: Gost34RequirementItem[] = parsedJson.map((item: any, idx: number) => ({
              id: `req-lmstudio-${Date.now()}-${idx}`,
              code: item.code || `ТР-ГОСТ-${String(idx + 1).padStart(2, '0')}`,
              category: ['functional', 'security', 'reliability', 'performance', 'ergonomics', 'technical'].includes(item.category)
                ? item.category
                : 'functional',
              title: item.title || item.code || 'Требование ГОСТ 34',
              description: item.description || item.title || '',
              sourceFile: `ИИ-Нормализация (${targetModel})`,
            }));

            return {
              requirements: llmRequirements,
              usedLlm: true,
              modelUsed: targetModel,
              providerUsed: 'LM Studio / OpenAI',
            };
          }
        }
      }
    } catch (e: any) {
      console.warn(`LM Studio / OpenAI API call failed (${e?.message}). Trying Ollama format or rules.`);
    }
  }

  // 3. Request via Ollama Native API (/api/generate)
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const res = await fetch(`${endpoint}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: targetModel,
        prompt: `${systemPrompt}\n\nИсходные требования вендора для нормализации:\n${userContent}\n\nJSON-ответ:`,
        stream: false,
        format: 'json',
      }),
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      const responseText = data.response?.trim();

      if (responseText) {
        const jsonMatch = responseText.match(/\[\s*\{[\s\S]*\}\s*\]/);
        const jsonString = jsonMatch ? jsonMatch[0] : responseText;
        const parsedJson = JSON.parse(jsonString);

        if (Array.isArray(parsedJson) && parsedJson.length > 0) {
          const llmRequirements: Gost34RequirementItem[] = parsedJson.map((item: any, idx: number) => ({
            id: `req-ollama-${Date.now()}-${idx}`,
            code: item.code || `ТР-ГОСТ-${String(idx + 1).padStart(2, '0')}`,
            category: ['functional', 'security', 'reliability', 'performance', 'ergonomics', 'technical'].includes(item.category)
              ? item.category
              : 'functional',
            title: item.title || item.code || 'Требование ГОСТ 34',
            description: item.description || item.title || '',
            sourceFile: `ИИ-Нормализация (${targetModel})`,
          }));

          return {
            requirements: llmRequirements,
            usedLlm: true,
            modelUsed: targetModel,
            providerUsed: 'Ollama',
          };
        }
      }
    }
  } catch (e: any) {
    console.warn(`Ollama native API call failed (${e?.message}). Falling back to heuristic rules.`);
  }

  // Fallback to rules if LLM parsing failed
  return {
    requirements: normalizeRequirementItems(rawItems),
    usedLlm: false,
  };
}
