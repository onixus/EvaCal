import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { chatCompletion, extractJsonValue, probeProvider } from '../client';
import { LlmProvider } from '../providers';

describe('LLM Client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Google Gemini integration', () => {
    const googleProvider: LlmProvider = {
      id: 'cloud-google',
      label: 'Google Gemini',
      kind: 'google',
      endpoint: 'https://generativelanguage.googleapis.com',
      defaultModel: 'gemini-2.5-flash',
    };

    it('probes Google Gemini provider and lists models', async () => {
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [{ name: 'models/gemini-2.5-flash' }, { name: 'models/gemini-2.5-pro' }],
        }),
      } as any);

      const status = await probeProvider(googleProvider);
      expect(status.available).toBe(true);
      expect(status.models).toEqual(['gemini-2.5-flash', 'gemini-2.5-pro']);
    });

    it('formats request and parses candidate response for Google Gemini', async () => {
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: '{"analysis": "Раздел ГОСТ соответствует нормам"}' }],
              },
            },
          ],
        }),
      } as any);

      const result = await chatCompletion({
        provider: googleProvider,
        model: 'gemini-2.5-flash',
        messages: [
          { role: 'system', content: 'Ты архитектор ГОСТ 34' },
          { role: 'user', content: 'Сгенерируй раздел' },
        ],
        temperature: 0.2,
        responseFormat: 'json',
      });

      expect(result.text).toBe('{"analysis": "Раздел ГОСТ соответствует нормам"}');
      expect(result.providerId).toBe('cloud-google');

      const [calledUrl, calledInit] = mockFetch.mock.calls[0];
      expect(String(calledUrl)).toContain('/v1beta/models/gemini-2.5-flash:generateContent');
      const body = JSON.parse(calledInit?.body as string);
      expect(body.systemInstruction.parts[0].text).toBe('Ты архитектор ГОСТ 34');
      expect(body.contents[0].parts[0].text).toBe('Сгенерируй раздел');
      expect(body.generationConfig.responseMimeType).toBe('application/json');
    });
  });

  describe('extractJsonValue', () => {
    it('should extract JSON array from markdown code block', () => {
      const text = `Here is your JSON:
\`\`\`json
[
  { "code": "REQ-1" }
]
\`\`\`
Hope it helps!`;
      const val = extractJsonValue(text);
      expect(Array.isArray(val)).toBe(true);
      expect((val as any[])[0].code).toBe('REQ-1');
    });

    it('should extract JSON object from markdown code block', () => {
      const text = `\`\`\`
{
  "nodeId": "tz-1",
  "paragraphs": ["Hello world"]
}
\`\`\``;
      const val = extractJsonValue(text);
      expect(typeof val).toBe('object');
      expect((val as any).nodeId).toBe('tz-1');
    });

    it('should extract raw JSON string', () => {
      const text = `[{"code":"REQ-2"}]`;
      const val = extractJsonValue(text);
      expect(Array.isArray(val)).toBe(true);
      expect((val as any[])[0].code).toBe('REQ-2');
    });
  });
});
