import {
  DEFAULT_ENDPOINT_POLICY,
  EndpointNotAllowedError,
  EndpointPolicy,
  assertAllowedEndpoint,
} from './endpointGuard';

/**
 * Server-side registry of LLM providers.
 *
 * The client picks a provider by **id**; the endpoint and the API key never
 * leave the server and are never accepted from a request. Adding a provider is
 * a deployment decision, made through environment variables.
 */
export interface LlmProvider {
  id: string;
  label: string;
  kind: 'ollama' | 'openai_compatible';
  /** Server-side only. Never serialise this to a client. */
  endpoint: string;
  /** Name of the env var holding the API key, if the provider needs one. */
  apiKeyEnv?: string;
  defaultModel?: string;
}

/** The subset that is safe to hand to the browser. */
export interface PublicLlmProvider {
  id: string;
  label: string;
  kind: LlmProvider['kind'];
}

export const OLLAMA_PROVIDER_ID = 'local-ollama';
export const LMSTUDIO_PROVIDER_ID = 'local-lmstudio';

function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw === '1' || raw.toLowerCase() === 'true';
}

export function getEndpointPolicy(): EndpointPolicy {
  return {
    allowLoopback: envFlag('EVACAL_LLM_ALLOW_LOOPBACK', DEFAULT_ENDPOINT_POLICY.allowLoopback),
    allowPrivateNetwork: envFlag(
      'EVACAL_LLM_ALLOW_PRIVATE_NETWORK',
      DEFAULT_ENDPOINT_POLICY.allowPrivateNetwork
    ),
  };
}

/**
 * Built-in local providers. They keep the out-of-the-box local-model workflow
 * working; set EVACAL_LLM_DISABLE_LOCAL=1 to drop them (e.g. in a SaaS deploy).
 */
function builtinProviders(): LlmProvider[] {
  if (envFlag('EVACAL_LLM_DISABLE_LOCAL', false)) return [];

  return [
    {
      id: OLLAMA_PROVIDER_ID,
      label: 'Ollama (локально)',
      kind: 'ollama',
      endpoint: process.env.OLLAMA_HOST || 'http://localhost:11434',
    },
    {
      id: LMSTUDIO_PROVIDER_ID,
      label: 'LM Studio / OpenAI-совместимый (локально)',
      kind: 'openai_compatible',
      endpoint: process.env.LMSTUDIO_HOST || 'http://localhost:1234/v1',
    },
  ];
}

/**
 * Extra providers from EVACAL_LLM_PROVIDERS — a JSON array of
 * {id,label,kind,endpoint,apiKeyEnv?,defaultModel?}. Malformed JSON is ignored
 * with a warning rather than crashing the route.
 */
function configuredProviders(): LlmProvider[] {
  const raw = process.env.EVACAL_LLM_PROVIDERS;
  if (!raw?.trim()) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e: any) {
    console.warn(`EVACAL_LLM_PROVIDERS is not valid JSON, ignoring it: ${e?.message}`);
    return [];
  }

  if (!Array.isArray(parsed)) {
    console.warn('EVACAL_LLM_PROVIDERS must be a JSON array, ignoring it.');
    return [];
  }

  const providers: LlmProvider[] = [];
  for (const entry of parsed as any[]) {
    if (!entry?.id || !entry?.endpoint) {
      console.warn('Skipping an EVACAL_LLM_PROVIDERS entry without id/endpoint.');
      continue;
    }
    providers.push({
      id: String(entry.id),
      label: String(entry.label || entry.id),
      kind: entry.kind === 'ollama' ? 'ollama' : 'openai_compatible',
      endpoint: String(entry.endpoint),
      apiKeyEnv: entry.apiKeyEnv ? String(entry.apiKeyEnv) : undefined,
      defaultModel: entry.defaultModel ? String(entry.defaultModel) : undefined,
    });
  }
  return providers;
}

/** All providers whose endpoint passes the guard, deduplicated by id. */
export function listLlmProviders(): LlmProvider[] {
  const policy = getEndpointPolicy();
  const byId = new Map<string, LlmProvider>();

  for (const provider of [...builtinProviders(), ...configuredProviders()]) {
    try {
      byId.set(provider.id, { ...provider, endpoint: assertAllowedEndpoint(provider.endpoint, policy) });
    } catch (e: any) {
      console.warn(`LLM provider "${provider.id}" is disabled: ${e?.message}`);
    }
  }

  return [...byId.values()];
}

export function listPublicLlmProviders(): PublicLlmProvider[] {
  return listLlmProviders().map(({ id, label, kind }) => ({ id, label, kind }));
}

export function getDefaultLlmProviderId(): string | undefined {
  return process.env.EVACAL_LLM_DEFAULT_PROVIDER || listLlmProviders()[0]?.id;
}

/**
 * Resolves a client-supplied provider id. Throws EndpointNotAllowedError for an
 * unknown id — the caller turns that into a 400, never a fetch.
 */
export function resolveLlmProvider(providerId?: string | null): LlmProvider {
  const providers = listLlmProviders();
  if (providers.length === 0) {
    throw new EndpointNotAllowedError('Ни один LLM-провайдер не настроен на сервере.');
  }

  const wanted = providerId || getDefaultLlmProviderId();
  const provider = providers.find((p) => p.id === wanted);
  if (!provider) {
    throw new EndpointNotAllowedError(`Неизвестный LLM-провайдер: ${providerId}`);
  }
  return provider;
}

/** Reads the provider's API key from the environment. Never from a request. */
export function getProviderApiKey(provider: LlmProvider): string | undefined {
  if (!provider.apiKeyEnv) return undefined;
  return process.env[provider.apiKeyEnv] || undefined;
}
