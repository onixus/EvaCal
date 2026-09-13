import { describe, it, expect } from 'vitest';
import {
  generateGost34Document,
  validateTzAuthorProposals,
  TzAuthorHardFlagsError,
} from '../index';
import { overlaysForDocument } from '../llm/tzAuthor/project';
import { TzAuthorState } from '../llm/tzAuthor/types';
import { Gost34CalculationInput } from '../types';
import { analyzeAndNormalizeInput } from '../analyzer';

const SAMPLE_CALCULATION: Gost34CalculationInput = {
  id: 'calc-export-test',
  name: 'Автоматизированная система управления заявками',
  customer: 'ПАО «Тест»',
  answers: {
    personalData: false,
    securitySignificant: false,
    criticalInfra: false,
  },
  stages: [
    {
      id: 'st-1',
      order: 1,
      name: 'Проектирование',
      role: 'архитектор',
      hours: 40,
    },
  ],
  risks: [],
};

describe('PR-06a: TZ Author Export Gate & Validation', () => {
  it('PROPOSED drafts are NOT projected into exported document AST or overrides', async () => {
    const tzAuthor: TzAuthorState = {
      promptVersion: 'tz-author-v1',
      speculateDefault: false,
      proposals: {
        'tz2020-general': {
          nodeId: 'tz2020-general',
          schemaTitle: 'Общие сведения',
          status: 'PROPOSED',
          paragraphs: ['СЕКРЕТНЫЙ_ТЕКСТ_ЧЕРНОВИКА_ИИ_PROPOSED'],
          questions: [],
          flags: [],
          refusedGapPaths: [],
          speculate: false,
          usedLlm: true,
          provenance: {
            providerId: 'ollama',
            model: 'test',
            promptVersion: 'tz-author-v1',
            temperature: 0.2,
            createdAt: new Date().toISOString(),
            createdBy: 'staff',
          },
        },
      },
    };

    const overrides = overlaysForDocument({ docType: 'TZ', tzAuthor });
    expect(overrides['tz2020-general']).toBeUndefined();

    const { ast } = await generateGost34Document({
      calculation: SAMPLE_CALCULATION,
      tzAuthor,
      metadataOverride: { docType: 'TZ' },
    });

    const generalSection = ast.sections.find((s) => s.id === 'tz2020-general');
    expect(generalSection).toBeDefined();
    const joinedText = generalSection?.paragraphs.join(' ') || '';
    expect(joinedText).not.toContain('СЕКРЕТНЫЙ_ТЕКСТ_ЧЕРНОВИКА_ИИ_PROPOSED');
  });

  it('valid ACCEPTED draft IS projected into exported document AST', async () => {
    const tzAuthor: TzAuthorState = {
      promptVersion: 'tz-author-v1',
      speculateDefault: false,
      proposals: {
        'tz2020-general': {
          nodeId: 'tz2020-general',
          schemaTitle: 'Общие сведения',
          status: 'ACCEPTED',
          paragraphs: [
            'Настоящее техническое задание определяет требования к автоматизированной системе.',
          ],
          questions: [],
          flags: [],
          refusedGapPaths: [],
          speculate: false,
          usedLlm: true,
          provenance: {
            providerId: 'ollama',
            model: 'test',
            promptVersion: 'tz-author-v1',
            temperature: 0.2,
            createdAt: new Date().toISOString(),
            createdBy: 'staff',
          },
        },
      },
    };

    const overrides = overlaysForDocument({ docType: 'TZ', tzAuthor });
    expect(overrides['tz2020-general']).toBeDefined();
    expect(overrides['tz2020-general'].paragraphs).toEqual([
      'Настоящее техническое задание определяет требования к автоматизированной системе.',
    ]);

    const { ast } = await generateGost34Document({
      calculation: SAMPLE_CALCULATION,
      tzAuthor,
      metadataOverride: { docType: 'TZ' },
    });

    const generalSection = ast.sections.find((s) => s.id === 'tz2020-general');
    expect(generalSection).toBeDefined();
    const joinedText = generalSection?.paragraphs.join(' ') || '';
    expect(joinedText).toContain('определяет требования к автоматизированной системе');
  });

  it('ACCEPTED draft with hard flag (LLM_INVENTED_NORM) throws TzAuthorHardFlagsError on export (409 gate)', async () => {
    const tzAuthorWithInventedNorm: TzAuthorState = {
      promptVersion: 'tz-author-v1',
      speculateDefault: false,
      proposals: {
        'tz2020-general': {
          nodeId: 'tz2020-general',
          schemaTitle: 'Общие сведения',
          status: 'ACCEPTED',
          paragraphs: [
            'Система должна соответствовать Приказу ФСТЭК России № 21 в полном объёме.',
          ],
          questions: [],
          flags: [], // client claims no flags
          refusedGapPaths: [],
          speculate: false,
          usedLlm: true,
          provenance: {
            providerId: 'ollama',
            model: 'test',
            promptVersion: 'tz-author-v1',
            temperature: 0.2,
            createdAt: new Date().toISOString(),
            createdBy: 'staff',
          },
        },
      },
    };

    await expect(
      generateGost34Document({
        calculation: SAMPLE_CALCULATION,
        tzAuthor: tzAuthorWithInventedNorm,
        metadataOverride: { docType: 'TZ' },
      }),
    ).rejects.toThrow(TzAuthorHardFlagsError);

    try {
      await generateGost34Document({
        calculation: SAMPLE_CALCULATION,
        tzAuthor: tzAuthorWithInventedNorm,
        metadataOverride: { docType: 'TZ' },
      });
      expect.unreachable('Should have thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(TzAuthorHardFlagsError);
      expect(err.statusCode).toBe(409);
      expect(err.code).toBe('tz_author_hard_flags');
      expect(err.nodes).toEqual([
        {
          nodeId: 'tz2020-general',
          flagCodes: ['LLM_INVENTED_NORM'],
        },
      ]);
    }
  });

  it('non-TZ documents (PZ) ignore tzAuthor and do not throw 409 even if tzAuthor has hard flags', async () => {
    const tzAuthorWithInventedNorm: TzAuthorState = {
      promptVersion: 'tz-author-v1',
      speculateDefault: false,
      proposals: {
        'tz2020-general': {
          nodeId: 'tz2020-general',
          schemaTitle: 'Общие сведения',
          status: 'ACCEPTED',
          paragraphs: [
            'Система должна соответствовать Приказу ФСТЭК России № 21 в полном объёме.',
          ],
          questions: [],
          flags: [],
          refusedGapPaths: [],
          speculate: false,
          usedLlm: true,
          provenance: {
            providerId: 'ollama',
            model: 'test',
            promptVersion: 'tz-author-v1',
            temperature: 0.2,
            createdAt: new Date().toISOString(),
            createdBy: 'staff',
          },
        },
      },
    };

    const { ast } = await generateGost34Document({
      calculation: SAMPLE_CALCULATION,
      tzAuthor: tzAuthorWithInventedNorm,
      metadataOverride: { docType: 'PZ' },
    });

    expect(ast.metadata.docType).toBe('PZ');
  });

  it('validateTzAuthorProposals drops hard-flagged proposal from validTzAuthor for preview and reports diagnostics', () => {
    const tzAuthor: TzAuthorState = {
      promptVersion: 'tz-author-v1',
      speculateDefault: false,
      proposals: {
        'tz2020-general': {
          nodeId: 'tz2020-general',
          schemaTitle: 'Общие сведения',
          status: 'ACCEPTED',
          paragraphs: [
            'Система должна соответствовать Приказу ФСТЭК России № 21.',
          ],
          questions: [],
          flags: [],
          refusedGapPaths: [],
          speculate: false,
          usedLlm: true,
          provenance: {} as any,
        },
        'tz2020-object': {
          nodeId: 'tz2020-object',
          schemaTitle: 'Объект автоматизации',
          status: 'ACCEPTED',
          paragraphs: ['Объектом автоматизации является процесс учёта заявок.'],
          questions: [],
          flags: [],
          refusedGapPaths: [],
          speculate: false,
          usedLlm: true,
          provenance: {} as any,
        },
      },
    };

    const payload = analyzeAndNormalizeInput({
      calculation: SAMPLE_CALCULATION,
      metadataOverride: { docType: 'TZ' },
    });

    const res = validateTzAuthorProposals({
      payload,
      tzAuthor,
    });

    expect(res.hasHardFlags).toBe(true);
    expect(res.diagnostics).toEqual([
      {
        nodeId: 'tz2020-general',
        flagCodes: ['LLM_INVENTED_NORM'],
      },
    ]);
    // The failing node tz2020-general is dropped from validTzAuthor
    expect(res.validTzAuthor.proposals['tz2020-general']).toBeUndefined();
    // The clean node tz2020-object remains valid
    expect(res.validTzAuthor.proposals['tz2020-object']).toBeDefined();
  });

  it('overlaysForDocument with includeProposed: true includes PROPOSED drafts', () => {
    const tzAuthor: TzAuthorState = {
      promptVersion: 'tz-author-v1',
      speculateDefault: false,
      proposals: {
        'tz2020-general': {
          nodeId: 'tz2020-general',
          schemaTitle: 'Общие сведения',
          status: 'PROPOSED',
          paragraphs: ['Текст черновика в предпросмотре'],
          questions: [],
          flags: [],
          refusedGapPaths: [],
          speculate: false,
          usedLlm: true,
          provenance: {} as any,
        },
      },
    };

    const withoutProposed = overlaysForDocument({ docType: 'TZ', tzAuthor, includeProposed: false });
    expect(withoutProposed['tz2020-general']).toBeUndefined();

    const withProposed = overlaysForDocument({ docType: 'TZ', tzAuthor, includeProposed: true });
    expect(withProposed['tz2020-general']).toEqual({
      paragraphs: ['Текст черновика в предпросмотре'],
    });
  });
});
