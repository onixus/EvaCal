import { Gost34RequirementItem, RequirementCategory } from '../types';
import {
  Gost34RequirementV2,
  fromGost34RequirementItems,
  toGost34RequirementItems,
} from '../requirements';
import { normalizeRequirementItemsV2 } from './requirementSanitizer';
import { LlmProvider, getProviderApiKey } from '../llm/providers';
import { chatCompletion, probeProvider, extractJsonValue } from '../llm/client';

export interface LlmNormalizerOptions {
  provider: LlmProvider;
  model?: string;
  temperature?: number;
  fallbackToRules?: boolean;
}

export interface LlmNormalizationResult {
  requirements: Gost34RequirementItem[];
  requirementsV2: Gost34RequirementV2[];
  usedLlm: boolean;
  modelUsed?: string;
  providerUsed?: string;
}

// Retained for backward compatibility during one release
export async function checkLocalLlmAvailability(
  endpoint: string = 'http://localhost:11434',
  providerKind: 'ollama' | 'openai_compatible' = 'ollama',
): Promise<{ available: boolean; provider: string; models: string[] }> {
  const dummyProvider: LlmProvider = {
    id: 'local_compat',
    label: 'Local Compat',
    endpoint,
    kind: providerKind,
  };
  const result = await probeProvider(dummyProvider);
  return { available: result.available, provider: providerKind, models: result.models };
}

const LLM_CATEGORIES = [
  'functional',
  'security',
  'reliability',
  'performance',
  'ergonomics',
  'technical',
];

interface LlmProposalRawItem {
  code?: string;
  category?: string;
  title?: string;
  description?: string;
}

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

  return parsedJson
    .map((item: LlmProposalRawItem, idx: number) => {
      // Match the reply back to its input by code, else positionally.
      const sourceRaw = (item.code && byCode.get(item.code)) || rawItems[idx];

      // In case the LLM returned more items than we sent
      if (!sourceRaw) {
        return null;
      }

      const source = fromGost34RequirementItems([sourceRaw])[0];
      const proposedText = item.description || item.title || '';

      const resolvedCategory =
        item.category && LLM_CATEGORIES.includes(item.category)
          ? (item.category as RequirementCategory)
          : source.category;

      const resolvedType = item.category === 'functional' ? 'system' : source.type;

      return {
        ...source,
        code: item.code || source.code,
        category: resolvedCategory,
        type: resolvedType,
        normalizedText: proposedText || source.normalizedText || source.originalText,
        approval: {
          status: 'PROPOSED',
          suggestedBy: `llm-${idPrefix}-${targetModel}`,
          suggestedAt: new Date(stamp).toISOString(),
        },
        legacy: {
          ...source.legacy,
          normalizedBy: `ИИ-Нормализация: ${idPrefix}`,
        },
      };
    })
    .filter(Boolean) as Gost34RequirementV2[];
}

/**
 * Требования из наборов решений (#103 WP-7b, `origin`) не нормализуются: их
 * текст, код и критерии принадлежат утверждённой версии набора, а сведения
 * пересчёта (kitCriterion, kitAuto*) нормализатор потерял бы. Они проходят
 * насквозь без изменений и остаются на своих местах; нормализуются остальные.
 */
export async function normalizeRequirementsWithLlm(
  rawItems: Gost34RequirementItem[],
  options: LlmNormalizerOptions,
): Promise<LlmNormalizationResult> {
  const isKit = (item: Gost34RequirementItem) => Boolean(item?.origin);
  if (!rawItems.some(isKit)) return normalizeItems(rawItems, options);
  const kitItems = rawItems.filter(isKit);
  const others = rawItems.filter((item) => !isKit(item));
  const result = others.length
    ? await normalizeItems(others, options)
    : { requirements: [], requirementsV2: [], usedLlm: false };
  const kitCopies = kitItems.map(
    (item) => JSON.parse(JSON.stringify(item)) as Gost34RequirementItem,
  );
  const kitV2 = fromGost34RequirementItems(kitCopies);
  let requirements: Gost34RequirementItem[];
  let requirementsV2: Gost34RequirementV2[];
  if (result.requirements.length === others.length) {
    // Длина сохранилась — требования наборов возвращаются на прежние позиции.
    requirements = [];
    requirementsV2 = [];
    let k = 0;
    let n = 0;
    for (const item of rawItems) {
      if (isKit(item)) {
        requirements.push(kitCopies[k]);
        requirementsV2.push(kitV2[k]);
        k += 1;
      } else {
        requirements.push(result.requirements[n]);
        requirementsV2.push(result.requirementsV2[n]);
        n += 1;
      }
    }
  } else {
    requirements = [...result.requirements, ...kitCopies];
    requirementsV2 = [...result.requirementsV2, ...kitV2];
  }
  return { ...result, requirements, requirementsV2 };
}

async function normalizeItems(
  rawItems: Gost34RequirementItem[],
  options: LlmNormalizerOptions,
): Promise<LlmNormalizationResult> {
  if (rawItems.length === 0) {
    return {
      requirements: [],
      requirementsV2: [],
      usedLlm: false,
    };
  }

  const provider = options.provider;
  const preferredModels = ['qwen2.5', 'llama3.2', 'mistral', 'deepseek-r1'];

  // 1. Check availability
  let detectedProvider = provider.kind;
  let models: string[] = [];

  const probeStatus = await probeProvider(provider);
  if (probeStatus.available) {
    models = probeStatus.models;
  } else {
    // try the other kind
    const otherKind = provider.kind === 'ollama' ? 'openai_compatible' : 'ollama';
    const altProbe = await probeProvider({ ...provider, kind: otherKind });
    if (altProbe.available) {
      detectedProvider = otherKind;
      models = altProbe.models;
    } else {
      if (options.fallbackToRules !== false) {
        return rulesFallback(rawItems);
      }
      throw new Error(`AI Server not available at ${provider.endpoint}`);
    }
  }

  let targetModel = options.model;
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

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    {
      role: 'user' as const,
      content: `Исходные требования вендора для нормализации:\n${userContent}`,
    },
  ];

  try {
    const res = await chatCompletion({
      provider: { ...provider, kind: detectedProvider },
      model: targetModel,
      messages,
      temperature: options.temperature ?? 0.2,
      responseFormat: 'json',
    });

    const parsedJson = extractJsonValue(res.text);

    if (Array.isArray(parsedJson) && parsedJson.length > 0) {
      const providerLabel =
        detectedProvider === 'openai_compatible' ? 'LM Studio / OpenAI' : 'Ollama';
      const idPrefix = detectedProvider === 'openai_compatible' ? 'lmstudio' : 'ollama';
      const proposals = buildLlmProposals(
        parsedJson as LlmProposalRawItem[],
        rawItems,
        targetModel,
        idPrefix,
      );
      return {
        requirements: toGost34RequirementItems(proposals, {
          preferNormalized: true,
        }),
        requirementsV2: proposals,
        usedLlm: true,
        modelUsed: targetModel,
        providerUsed: providerLabel,
      };
    }
  } catch (e: any) {
    console.warn(`Primary chatCompletion failed (${e?.message}).`);
  }

  // Fallback to Ollama if primary was OpenAI-compatible
  if (detectedProvider === 'openai_compatible') {
    try {
      const res = await chatCompletion({
        provider: { ...provider, kind: 'ollama' },
        model: targetModel,
        messages,
        temperature: options.temperature ?? 0.2,
        responseFormat: 'json',
      });

      const parsedJson = extractJsonValue(res.text);

      if (Array.isArray(parsedJson) && parsedJson.length > 0) {
        const proposals = buildLlmProposals(
          parsedJson as LlmProposalRawItem[],
          rawItems,
          targetModel,
          'ollama',
        );
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
    } catch (e: any) {
      console.warn(`Fallback Ollama chatCompletion failed (${e?.message}).`);
    }
  }

  if (options.fallbackToRules !== false) {
    return rulesFallback(rawItems);
  }

  throw new Error('LLM normalization failed and fallback to rules is disabled.');
}
