import { describe, it, expect, vi, afterEach } from 'vitest';
import { Gost34RequirementItem } from '../../types';
import { normalizeRequirementsWithLlm } from '../llmNormalizer';
import type { LlmProvider } from '../../llm/providers';

const testProvider: LlmProvider = {
  id: 'test-lmstudio',
  label: 'Test LM Studio',
  kind: 'openai_compatible',
  endpoint: 'http://localhost:1234/v1',
};

const rawItems: Gost34RequirementItem[] = [
  {
    id: 'r1',
    code: 'ТР-БЕЗ-01',
    category: 'security',
    title: 'Журналирование',
    description: 'вести журнал событий безопасности',
    sourceFile: 'vendor-tz.docx',
  },
];

const LLM_REPLY = [
  {
    code: 'ТР-БЕЗ-01',
    category: 'security',
    title: 'Журналирование событий безопасности',
    description: 'Система должна обеспечивать ведение журнала событий безопасности.',
  },
];

/** LM Studio: GET /v1/models for the probe, POST /v1/chat/completions for the reply. */
function stubLmStudio(reply: unknown) {
  const fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes('/models')) {
      return {
        ok: true,
        json: async () => ({ data: [{ id: 'local-model' }] }),
      } as any;
    }
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(reply) } }],
      }),
    } as any;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('normalizeRequirementsWithLlm', () => {
  it('keeps the original text and the real source file', async () => {
    stubLmStudio(LLM_REPLY);

    const result = await normalizeRequirementsWithLlm(rawItems, {
      provider: testProvider,
    });

    expect(result.usedLlm).toBe(true);
    const [proposal] = result.requirementsV2;
    expect(proposal.originalText).toBe('вести журнал событий безопасности');
    expect(proposal.normalizedText).toBe(LLM_REPLY[0].description);
    expect(proposal.source?.filename).toBe('vendor-tz.docx');
    expect(proposal.legacy?.normalizedBy).toContain('ИИ-Нормализация');
  });

  it('marks LLM output as a proposal, never as approved', async () => {
    stubLmStudio(LLM_REPLY);
    const result = await normalizeRequirementsWithLlm(rawItems, {
      provider: testProvider,
    });
    expect(result.requirementsV2[0].approval.status).toBe('PROPOSED');
  });

  it('still shows the model wording in the legacy item, with provenance attached', async () => {
    stubLmStudio(LLM_REPLY);
    const result = await normalizeRequirementsWithLlm(rawItems, {
      provider: testProvider,
    });
    const [item] = result.requirements;
    expect(item.description).toBe(LLM_REPLY[0].description);
    expect(item.originalText).toBe('вести журнал событий безопасности');
    expect(item.sourceFile).toBe('vendor-tz.docx');
    expect(item.normalizedBy).toContain('ИИ-Нормализация');
  });

  it('matches a reply positionally when the model changes the code', async () => {
    stubLmStudio([{ ...LLM_REPLY[0], code: 'ТР-НОВЫЙ-77' }]);
    const result = await normalizeRequirementsWithLlm(rawItems, {
      provider: testProvider,
    });
    expect(result.requirementsV2[0].originalText).toBe('вести журнал событий безопасности');
    expect(result.requirementsV2[0].code).toBe('ТР-НОВЫЙ-77');
  });

  it('falls back to rules when the endpoint is unreachable, preserving the original', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );

    const result = await normalizeRequirementsWithLlm(rawItems, {
      provider: testProvider,
    });
    expect(result.usedLlm).toBe(false);
    expect(result.requirementsV2[0].originalText).toBe('вести журнал событий безопасности');
    expect(result.requirements[0].description).toBe('вести журнал событий безопасности');
  });

  it('falls back to rules on a malformed reply without throwing', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/models')) {
        return {
          ok: true,
          json: async () => ({ data: [{ id: 'local-model' }] }),
        } as any;
      }
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'не JSON' } }] }),
      } as any;
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await normalizeRequirementsWithLlm(rawItems, {
      provider: testProvider,
    });
    expect(result.usedLlm).toBe(false);
    expect(result.requirementsV2[0].originalText).toBe('вести журнал событий безопасности');
  });
});
