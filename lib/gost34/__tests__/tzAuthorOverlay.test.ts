import { describe, it, expect } from 'vitest';
import { overlaysForDocument } from '../llm/tzAuthor/project';
import { applySectionOverrides, stripClausePrefix } from '../index';
import { Gost34Section } from '../types';
import { TzAuthorState } from '../llm/tzAuthor/types';

describe('tzAuthorOverlay', () => {
  describe('stripClausePrefix', () => {
    it('removes prefix with multiple digits and dots', () => {
      expect(stripClausePrefix('4.4.1 Hello')).toBe('Hello');
      expect(stripClausePrefix('10.2.3.4.5  World')).toBe('World');
    });

    it('keeps text without prefix intact', () => {
      expect(stripClausePrefix('Hello world 4.4')).toBe('Hello world 4.4');
    });

    it('keeps a bare leading number — it is content, not a clause number', () => {
      expect(stripClausePrefix('30 минут RTO для контура')).toBe('30 минут RTO для контура');
      expect(stripClausePrefix('2 контура резервирования')).toBe('2 контура резервирования');
    });
  });

  describe('overlaysForDocument', () => {
    it('returns empty object if no overrides and no tzAuthor', () => {
      expect(overlaysForDocument({ docType: 'TZ' })).toEqual({});
    });

    it('ignores tzAuthor for non-TZ docType', () => {
      const tzAuthor: TzAuthorState = {
        promptVersion: 'tz-author-v1',
        speculateDefault: false,
        proposals: {
          'tz2020-general': {
            nodeId: 'tz2020-general',
            schemaTitle: 'Общие сведения',
            status: 'ACCEPTED',
            paragraphs: ['LLM p1'],
            questions: [],
            flags: [],
            refusedGapPaths: [],
            speculate: false,
            usedLlm: true,
            provenance: {} as any,
          },
        },
      };

      const result = overlaysForDocument({ docType: 'PZ', tzAuthor });
      expect(result).toEqual({});
    });

    it('includes ACCEPTED and ACCEPTED_EDITED proposals for TZ docType by nodeId', () => {
      const tzAuthor: TzAuthorState = {
        promptVersion: 'tz-author-v1',
        speculateDefault: false,
        proposals: {
          'tz2020-general': {
            nodeId: 'tz2020-general',
            schemaTitle: 'Общие сведения',
            status: 'ACCEPTED',
            paragraphs: ['LLM p1'],
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
            status: 'ACCEPTED_EDITED',
            paragraphs: ['LLM p2 edited'],
            questions: [],
            flags: [],
            refusedGapPaths: [],
            speculate: false,
            usedLlm: true,
            provenance: {} as any,
          },
          'tz2020-req-structure': {
            nodeId: 'tz2020-req-structure',
            schemaTitle: 'Требования к структуре',
            status: 'PROPOSED',
            paragraphs: ['LLM p3 proposed'],
            questions: [],
            flags: [],
            refusedGapPaths: [],
            speculate: false,
            usedLlm: true,
            provenance: {} as any,
          },
        },
      };

      const result = overlaysForDocument({ docType: 'TZ', tzAuthor });
      expect(result['tz2020-general']).toEqual({ paragraphs: ['LLM p1'] });
      expect(result['tz2020-object']).toEqual({ paragraphs: ['LLM p2 edited'] });
      expect(result['tz2020-req-structure']).toBeUndefined();
    });

    it('manual sectionOverrides fallback to title keys, but tzAuthor id keys win', () => {
      const tzAuthor: TzAuthorState = {
        promptVersion: 'tz-author-v1',
        speculateDefault: false,
        proposals: {
          'tz2020-general': {
            nodeId: 'tz2020-general',
            schemaTitle: 'Общие сведения',
            status: 'ACCEPTED',
            paragraphs: ['LLM wins'],
            questions: [],
            flags: [],
            refusedGapPaths: [],
            speculate: false,
            usedLlm: true,
            provenance: {} as any,
          },
        },
      };

      const sectionOverrides = {
        'Общие сведения': { paragraphs: ['Manual override'] },
        'tz2020-object': { paragraphs: ['Manual id override'] },
      };

      const result = overlaysForDocument({ docType: 'TZ', sectionOverrides, tzAuthor });
      expect(result['tz2020-general']).toEqual({ paragraphs: ['LLM wins'] });
      expect(result['Общие сведения']).toEqual({ paragraphs: ['Manual override'] });
      expect(result['tz2020-object']).toEqual({ paragraphs: ['Manual id override'] });
    });
  });

  describe('applySectionOverrides', () => {
    it('applies paragraphs with deterministic numbering based on numStr', () => {
      const sections: Gost34Section[] = [
        {
          id: 'tz2020-req-common-tech',
          title: 'Требования к надежности',
          numStr: '4.4',
          paragraphs: ['Baseline p1'],
        },
      ];

      const overrides = {
        'tz2020-req-common-tech': { paragraphs: ['New p1', 'New p2'] },
      };

      const applied = applySectionOverrides(sections, overrides);
      expect(applied[0].paragraphs).toEqual(['4.4.1 New p1', '4.4.2 New p2']);
    });

    it('does not duplicate numbering if overlay already contains it', () => {
      const sections: Gost34Section[] = [
        {
          id: 'tz2020-req-common-tech',
          title: 'Требования к надежности',
          numStr: '4.4',
          paragraphs: ['Baseline p1'],
        },
      ];

      const overrides = {
        'tz2020-req-common-tech': { paragraphs: ['4.4.1 Already numbered'] },
      };

      const applied = applySectionOverrides(sections, overrides);
      expect(applied[0].paragraphs).toEqual(['4.4.1 Already numbered']);
    });

    it('Reset -> baseline (no overrides match)', () => {
      const sections: Gost34Section[] = [
        {
          id: 'tz2020-general',
          title: 'Общие сведения',
          numStr: '1',
          paragraphs: ['1.1 Baseline p1'],
        },
      ];

      const applied = applySectionOverrides(sections, {});
      expect(applied[0].paragraphs).toEqual(['1.1 Baseline p1']);
    });
  });
});
