import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runGrokDocumentReview } from '../aiReviewEngine';
import * as client from '../../llm/client';
import * as providers from '../../llm/providers';

describe('aiReviewEngine with Grok', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('runs document review using Grok review prompt and parses findings', async () => {
    const mockProvider: providers.LlmProvider = {
      id: 'cloud-grok',
      label: 'xAI Grok',
      kind: 'openai_compatible',
      endpoint: 'https://api.x.ai/v1',
      defaultModel: 'grok-2-latest',
      purpose: 'review',
    };

    vi.spyOn(providers, 'resolveLlmProvider').mockReturnValue(mockProvider);
    vi.spyOn(client, 'chatCompletion').mockResolvedValue({
      text: JSON.stringify({
        summary: 'Документ в целом качественный, но есть 1 блокер по требованиям ИБ',
        findings: [
          {
            sectionId: 'tz-sec-4',
            severity: 'blocker',
            text: 'Отсутствуют требования к резервному копированию по ГОСТ 34.602',
            clauseRef: 'ГОСТ 34.602-2020 п. 4.2',
          },
          {
            sectionId: 'tz-sec-2',
            severity: 'remark',
            text: 'Размытые сроки опытной эксплуатации',
          },
        ],
      }),
      model: 'grok-2-latest',
      providerId: 'cloud-grok',
      latencyMs: 120,
    });

    const report = await runGrokDocumentReview({
      docType: 'TZ',
      documentTitle: 'ТЗ на модернизацию АС',
      sections: [
        {
          id: 'tz-sec-2',
          title: 'Характеристика объекта',
          content: 'Опытная эксплуатация проводится в разумные сроки.',
        },
        {
          id: 'tz-sec-4',
          title: 'Требования к системе',
          content: 'Система должна работать круглосуточно.',
        },
      ],
    });

    expect(report.ok).toBe(true);
    expect(report.providerId).toBe('cloud-grok');
    expect(report.model).toBe('grok-2-latest');
    expect(report.summary).toContain('Документ в целом качественный');
    expect(report.findings).toHaveLength(2);
    expect(report.findings[0]).toEqual({
      sectionId: 'tz-sec-4',
      severity: 'blocker',
      text: 'Отсутствуют требования к резервному копированию по ГОСТ 34.602',
      clauseRef: 'ГОСТ 34.602-2020 п. 4.2',
    });
    expect(report.findings[1].severity).toBe('remark');
  });
});
