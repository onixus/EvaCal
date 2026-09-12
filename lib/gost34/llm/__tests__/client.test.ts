import { describe, it, expect } from 'vitest';
import { extractJsonValue } from '../client';

describe('LLM Client', () => {
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
