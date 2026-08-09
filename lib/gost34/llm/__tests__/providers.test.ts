import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EndpointNotAllowedError } from "../endpointGuard";
import {
  LMSTUDIO_PROVIDER_ID,
  OLLAMA_PROVIDER_ID,
  getProviderApiKey,
  listLlmProviders,
  listPublicLlmProviders,
  resolveLlmProvider,
} from "../providers";

const ENV_KEYS = [
  "OLLAMA_HOST",
  "LMSTUDIO_HOST",
  "EVACAL_LLM_PROVIDERS",
  "EVACAL_LLM_DEFAULT_PROVIDER",
  "EVACAL_LLM_DISABLE_LOCAL",
  "EVACAL_LLM_ALLOW_LOOPBACK",
  "EVACAL_LLM_ALLOW_PRIVATE_NETWORK",
];

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const key of ENV_KEYS) delete process.env[key];
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.restoreAllMocks();
});

describe("built-in local providers", () => {
  it("ships Ollama and LM Studio out of the box", () => {
    expect(listLlmProviders().map((p) => p.id)).toEqual([
      OLLAMA_PROVIDER_ID,
      LMSTUDIO_PROVIDER_ID,
    ]);
  });

  it("honours OLLAMA_HOST / LMSTUDIO_HOST", () => {
    process.env.OLLAMA_HOST = "http://127.0.0.1:9999/";
    expect(resolveLlmProvider(OLLAMA_PROVIDER_ID).endpoint).toBe(
      "http://127.0.0.1:9999",
    );
  });

  it("drops a built-in whose configured endpoint fails the guard", () => {
    process.env.OLLAMA_HOST = "http://169.254.169.254";
    expect(listLlmProviders().map((p) => p.id)).toEqual([LMSTUDIO_PROVIDER_ID]);
  });

  it("can be disabled entirely", () => {
    process.env.EVACAL_LLM_DISABLE_LOCAL = "1";
    expect(listLlmProviders()).toEqual([]);
    expect(() => resolveLlmProvider()).toThrow(EndpointNotAllowedError);
  });
});

describe("EVACAL_LLM_PROVIDERS", () => {
  it("adds a remote provider with a key held in the environment", () => {
    process.env.EVACAL_LLM_PROVIDERS = JSON.stringify([
      {
        id: "corp",
        label: "Corp LLM",
        kind: "openai_compatible",
        endpoint: "https://llm.example.com/v1",
        apiKeyEnv: "CORP_LLM_KEY",
      },
    ]);
    process.env.CORP_LLM_KEY = "secret-value";

    const provider = resolveLlmProvider("corp");
    expect(provider.endpoint).toBe("https://llm.example.com/v1");
    expect(getProviderApiKey(provider)).toBe("secret-value");

    delete process.env.CORP_LLM_KEY;
  });

  it("ignores malformed JSON instead of crashing", () => {
    process.env.EVACAL_LLM_PROVIDERS = "{not json";
    expect(listLlmProviders().length).toBe(2);
  });

  it("skips entries without an id or an endpoint, and entries the guard rejects", () => {
    process.env.EVACAL_LLM_PROVIDERS = JSON.stringify([
      { label: "no id", endpoint: "https://a.example.com" },
      { id: "no-endpoint" },
      { id: "metadata", endpoint: "http://169.254.169.254" },
      { id: "ok", endpoint: "https://ok.example.com/v1" },
    ]);
    expect(listLlmProviders().map((p) => p.id)).toContain("ok");
    expect(listLlmProviders().map((p) => p.id)).not.toContain("metadata");
    expect(listLlmProviders().map((p) => p.id)).not.toContain("no-endpoint");
  });
});

describe("resolveLlmProvider", () => {
  it("rejects an unknown id rather than fetching it", () => {
    expect(() => resolveLlmProvider("nope")).toThrow(EndpointNotAllowedError);
  });

  it("never accepts a URL as the id", () => {
    expect(() => resolveLlmProvider("http://169.254.169.254")).toThrow(
      EndpointNotAllowedError,
    );
  });

  it("falls back to EVACAL_LLM_DEFAULT_PROVIDER, then to the first provider", () => {
    process.env.EVACAL_LLM_DEFAULT_PROVIDER = LMSTUDIO_PROVIDER_ID;
    expect(resolveLlmProvider().id).toBe(LMSTUDIO_PROVIDER_ID);

    delete process.env.EVACAL_LLM_DEFAULT_PROVIDER;
    expect(resolveLlmProvider().id).toBe(OLLAMA_PROVIDER_ID);
  });
});

describe("listPublicLlmProviders", () => {
  it("never leaks the endpoint or the key env name to the client", () => {
    process.env.EVACAL_LLM_PROVIDERS = JSON.stringify([
      {
        id: "corp",
        label: "Corp",
        kind: "openai_compatible",
        endpoint: "https://llm.example.com/v1",
        apiKeyEnv: "CORP_LLM_KEY",
      },
    ]);

    for (const provider of listPublicLlmProviders()) {
      expect(Object.keys(provider).sort()).toEqual(["id", "kind", "label"]);
    }
  });
});
