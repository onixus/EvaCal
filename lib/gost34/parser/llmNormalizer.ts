import { Gost34RequirementItem, RequirementCategory } from '../types';
import {
  Gost34RequirementV2,
  fromGost34RequirementItems,
  toGost34RequirementItems,
} from '../requirements';
import { normalizeRequirementItemsV2 } from './requirementSanitizer';
import { LlmProvider, getProviderApiKey } from '../llm/providers';

export interface LlmNormalizerOptions {
  /**
   * Resolved server-side provider. There is deliberately no `endpoint` or
   * `apiKey` option: a caller must not be able to choose what the server
   * connects to, or what credential it sends. See lib/gost34/llm/providers.ts.
   */
  provider: LlmProvider;
  model?: string; // Default: llama3.2, qwen2.5, mistral, deepseek-r1
  temperature?: number;
  fallbackToRules?: boolean;
}

interface OllamaModelItem {
  name?: string;
  model?: string;
}

interface OpenAiModelItem {
  id?: string;
  name?: string;
}

interface LlmProposalRawItem {
  code?: string;
  category?: string;
  title?: string;
  description?: string;
  confidence?: number;
}

/**
 * Checks availability of Ollama or LM Studio / OpenAI-compatible endpoint.
 */
export async function checkLocalLlmAvailability(
  endpoint: string = 'http://localhost:11434',
  provider: 'ollama' | 'openai_compatible' = 'ollama',
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
        const data = (await res.json()) as { models?: OllamaModelItem[] };
        const models = (data.models || [])
          .map((m) => m.name || m.model)
          .filter((name): name is string => typeof name === 'string' && name.length > 0);
        return { available: true, provider: 'ollama', models };
      }
    } catch {
      // Ignore and try OpenAI / LM Studio endpoint
    }
  }

  // 2. Try OpenAI-compatible / LM Studio API (/v1/models or /models)
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);

    const modelsUrl = cleanEndpoint.endsWith('/v1')
      ? `${cleanEndpoint}/models`
      : `${cleanEndpoint}/v1/models`;

    const res = await fetch(modelsUrl, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = (await res.json()) as { data?: OpenAiModelItem[] };
      const models = (data.data || [])
        .map((m) => m.id || m.name)
        .filter((name): name is string => typeof name === 'string' && name.length > 0);
      return { available: true, provider: 'openai_compatible', models };
    }
  } catch {
    // Both failed
  }

  return { available: false, provider, models: [] };
}

const LLM_CATEGORIES = [
  'functional',
  'security',
  'reliability',
  'performance',
  'ergonomics',
  'technical',
];

/**
 * Turns an LLM reply into requirement *proposals*.
 *
 * The model's wording lands in `normalizedText`; `originalText` stays the text
 * that came out of the vendor document, and the source filename stays the real
 * file. Proposals are never APPROVED — a human accepts them (PR-08), and until
 * then the effective text of the requirement is still the original.
 */
function buildLlmProposals(
  parsedJson: LlmProposalRawItem[],
  rawItems: Gost34RequirementItem[],
  targetModel: string,
  idPrefix: string,
): Gost34RequirementV2[] {
  const byCode = new Map<string, Gost34RequirementItem>();
  for (const item of rawItems) {
    if (item.code && !byCode.has(item.code)) byCode.set(item.code, item);
  }

  const stamp = Date.now();

  return parsedJson.map((item: LlmProposalRawItem, idx: number) => {
    // Match the reply back to its input by code, else positionally.
    const source = (item.code && byCode.get(item.code)) || rawItems[idx];
    const proposedText = item.description || item.title || '';

    const resolvedCategory =
      item.category && LLM_CATEGORIES.includes(item.category)
        ? (item.category as RequirementCategory)
        : source?.category || 'functional';

    const proposal: Gost34RequirementV2 = {
      id: source?.id || `${idPrefix}-${stamp}-${idx}`,
      code: item.code || source?.code || `ТР-ГОСТ-${String(idx + 1).padStart(2, '0')}`,
      category: resolvedCategory,
      type: 'system',
      title: item.title || item.code || 'Требование ГОСТ 34',
      originalText: source?.originalText ?? source?.description ?? proposedText,
      normalizedText: proposedText,
      approval: { status: 'PROPOSED' },
      legacy: { normalizedBy: `ИИ-Нормализация (${targetModel})` },
    };

    if (source?.sourceFile) proposal.source = { filename: source.sourceFile };
    if (typeof item.confidence === 'number') proposal.confidence = item.confidence;
    if (source?.stageName) proposal.legacy!.stageName = source.stageName;
    if (source?.stageRole) proposal.legacy!.stageRole = source.stageRole;

    return proposal;
  });
}

/** Rule-based normalization, used whenever the LLM is unavailable or unusable. */
function rulesFallback(rawItems: Gost34RequirementItem[]): LlmNormalizationResult {
  const normalized = normalizeRequirementItemsV2(fromGost34RequirementItems(rawItems));
  return {
    requirements: toGost34RequirementItems(normalized, {
      preferNormalized: true,
    }),
    requirementsV2: normalized,
    usedLlm: false,
  };
}

export interface LlmNormalizationResult {
  /** Legacy-shaped items for the existing pipeline; description shows the proposal. */
  requirements: Gost34RequirementItem[];
  /** Full proposals with provenance and approval state. */
  requirementsV2: Gost34RequirementV2[];
  usedLlm: boolean;
  modelUsed?: string;
  providerUsed?: string;
}

/**
 * Normalizes raw unstructured requirement text using Ollama or LM Studio / OpenAI API.
 */
export async function normalizeRequirementsWithLlm(
  rawItems: Gost34RequirementItem[],
  options: LlmNormalizerOptions,
): Promise<LlmNormalizationResult> {
  const provider = options.provider.kind;
  const endpoint = options.provider.endpoint.replace(/\/+$/, '');
  const apiKey = getProviderApiKey(options.provider);
  const fallbackToRules = options.fallbackToRules !== false;

  // 1. Check availability
  const {
    available,
    models,
    provider: detectedProvider,
  } = await checkLocalLlmAvailability(endpoint, provider);

  if (!available) {
    if (fallbackToRules) {
      return rulesFallback(rawItems);
    } else {
      throw new Error(
        `ИИ-сервер недоступен по адресу ${endpoint}. Запустите Ollama или LM Studio.`,
      );
    }
  }

  const preferredModels = [
    'qwen2.5',
    'llama3.2',
    'llama3',
    'mistral',
    'deepseek-r1',
    'gemma2',
    'local-model',
  ];
  let targetModel = options.model || options.provider.defaultModel;

  if (!targetModel) {
    targetModel =
      models.find((m) => preferredModels.some((pref) => m.toLowerCase().includes(pref))) ||
      models[0] ||
      'llama3.2';
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
    2,
  );

  // 2. Request via LM Studio / OpenAI Chat Completions API
  if (detectedProvider === 'openai_compatible' || provider === 'openai_compatible') {
    try {
      const chatUrl = endpoint.endsWith('/v1')
        ? `${endpoint}/chat/completions`
        : `${endpoint}/v1/chat/completions`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const res = await fetch(chatUrl, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          model: targetModel,
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: `Исходные требования вендора для нормализации:\n${userContent}`,
            },
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
            const proposals = buildLlmProposals(parsedJson, rawItems, targetModel, 'req-lmstudio');

            return {
              requirements: toGost34RequirementItems(proposals, {
                preferNormalized: true,
              }),
              requirementsV2: proposals,
              usedLlm: true,
              modelUsed: targetModel,
              providerUsed: 'LM Studio / OpenAI',
            };
          }
        }
      }
    } catch (e: any) {
      console.warn(
        `LM Studio / OpenAI API call failed (${e?.message}). Trying Ollama format or rules.`,
      );
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
          const proposals = buildLlmProposals(parsedJson, rawItems, targetModel, 'req-ollama');

          return {
            requirements: toGost34RequirementItems(proposals, {
              preferNormalized: true,
            }),
            requirementsV2: proposals,
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
  return rulesFallback(rawItems);
}
