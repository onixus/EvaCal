import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { prepareGost34Document } from '../prepareDocument';
import { generateGost34Document } from '../exportDocument';
import { Gost34StructureError, UnsupportedGostDocumentTypeError } from '../errors';
import { GOLDEN_SCENARIOS } from '../../__tests__/golden/scenarios';
import { buildProjectContext } from '../../context/builder';
import { contentDisposition } from '../../../exportResponse';
import type { GostDocumentType } from '../../types';
import type { TzAuthorState } from '../../llm/tzAuthor/types';
import { DEFAULT_SIGNATURES } from '../../metadataDefaults';
import { LEGACY_GOST34_PROFILE_ID } from '../../standards';
import { TzAuthorHardFlagsError } from '../../llm/tzAuthor/validate';

const calculation = { name: 'Система заявок', customer: 'Заказчик', stages: [], risks: [] };

describe('Shared GOST preparation and export', () => {
  it.each(GOLDEN_SCENARIOS)('keeps preview and export equal for $id', async (scenario) => {
    const params = {
      calculation: scenario.calculation,
      projectContext: scenario.projectContext,
      vendorFiles: ['source.pdf'],
      metadataOverride: {
        docType: scenario.docType,
        standardProfileId: scenario.standardProfileId,
      },
    };
    const preview = prepareGost34Document(params, { mode: 'preview' });
    const exported = await generateGost34Document(params);
    expect(exported.ast).toEqual(preview.ast);
    expect(exported.diagnostics.issues).toEqual([]);
    const zip = await JSZip.loadAsync(exported.buffer);
    if (scenario.standardProfileId !== LEGACY_GOST34_PROFILE_ID) {
      expect(await zip.file('word/document.xml')!.async('string')).toContain('source.pdf');
    }
  });

  it.each([[], ['   '], ['1.1 ']].map((paragraphs) => ({ paragraphs })))(
    'rejects an emptied mandatory section: $paragraphs',
    ({ paragraphs }) => {
      const params = { calculation, sectionOverrides: { 'tz2020-general': { paragraphs } } };
      const preview = prepareGost34Document(params, { mode: 'preview' });
      expect(preview.diagnostics.issues).toContainEqual(
        expect.objectContaining({
          nodeId: 'tz2020-general',
          kind: 'empty',
        }),
      );
      expect(preview.baselineAst.sections[0].paragraphs.length).toBeGreaterThan(0);
      expect(() => prepareGost34Document(params)).toThrow(Gost34StructureError);
    },
  );

  it.each(['unknown', 'constructor', '__proto__'])('rejects unsupported type %s', (docType) => {
    expect(() =>
      prepareGost34Document({ metadataOverride: { docType: docType as GostDocumentType } }),
    ).toThrow(UnsupportedGostDocumentTypeError);
  });

  it('does not insert sample signatories, contract, date or inventory number', async () => {
    const { ast, buffer } = await generateGost34Document({ calculation });
    expect(Object.values(ast.metadata.signatures).every((value) => value === '')).toBe(true);
    expect(ast.metadata.contractNumber).toBe('');
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).not.toMatch(/Иванов|Петров|Александров|01-ГС|ИНВ-102938|06\.08\.2026/);
  });

  it('preserves actual metadata and ignores omitted overrides', () => {
    const { ast } = prepareGost34Document({
      calculation,
      metadataOverride: {
        city: undefined,
        contractNumber: 'Договор 12',
        signatures: {
          ...DEFAULT_SIGNATURES,
          developer: 'Автор',
          approver: 'Согласующий',
          signDate: '21.09.2026',
        },
      },
    });
    expect(ast.metadata.city).toBe('Требует уточнения у Заказчика');
    expect(ast.metadata.contractNumber).toBe('Договор 12');
    expect(ast.metadata.signatures.signDate).toBe('21.09.2026');
  });

  it('does not derive PDn, KII obligations or protection class from NGFW quantities', () => {
    const context = buildProjectContext({
      answers: { ngfw_clusters_count: 2, vpn_tunnels_count: 5 },
    });
    expect(context.security?.personalDataProcessed).toBeUndefined();
    expect(context.security?.regulatoryScope).toBeUndefined();
    expect(context.security?.securityClass).toBeUndefined();
    const explicit = buildProjectContext({
      answers: { ngfw_clusters_count: 2 },
      override: { security: { personalDataProcessed: false, kiiObject: false } },
    });
    expect(explicit.security).toEqual({ personalDataProcessed: false, kiiObject: false });
  });

  it('includes funding details or explicitly reports the missing information', () => {
    const missing = prepareGost34Document({ calculation });
    expect(missing.diagnostics.gaps).toContainEqual(expect.objectContaining({ path: 'funding' }));
    const filled = prepareGost34Document({
      calculation,
      projectContext: {
        funding: 'Средства Заказчика, оплата по этапам',
      },
    });
    expect(JSON.stringify(filled.ast.sections)).toContain('Средства Заказчика, оплата по этапам');
    expect(filled.diagnostics.gaps.some((gap) => gap.path === 'funding')).toBe(false);
  });

  it('returns a valid Content-Disposition header for Cyrillic filenames', () => {
    const header = contentDisposition('ТЗ Система', 'docx');
    expect(() => new Headers({ 'Content-Disposition': header })).not.toThrow();
    expect(header).toContain(`filename*=UTF-8''${encodeURIComponent('ТЗ Система')}.docx`);
  });

  it('keeps the LLM gate in export and suppresses invalid overlays in preview', () => {
    const tzAuthor = {
      promptVersion: 'tz-author-v1',
      speculateDefault: false,
      proposals: {
        'tz2020-general': {
          nodeId: 'tz2020-general',
          schemaTitle: 'Общие сведения',
          status: 'ACCEPTED',
          paragraphs: ['Система должна соответствовать Приказу ФСТЭК России № 21.'],
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
            createdAt: '2026-09-21',
            createdBy: 'test',
          },
        },
      },
    } as TzAuthorState;
    const params = { calculation, tzAuthor };
    expect(() => prepareGost34Document(params)).toThrow(TzAuthorHardFlagsError);
    const preview = prepareGost34Document(params, { mode: 'preview' });
    expect(preview.tzAuthorDiagnostics).toHaveLength(1);
    expect(preview.ast.sections).toEqual(preview.baselineAst.sections);
  });
});
