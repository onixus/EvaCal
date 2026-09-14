import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  detectDraftFlags,
  extractConstraints,
  extractCitations,
  extractModality,
  canonUnit,
} from '../flags';
import { GroundingPack } from '../grounding';

describe('PR-04: Fact-diff (detectDraftFlags)', () => {
  describe('canonUnit', () => {
    it('normalizes units to canonical identifiers', () => {
      expect(canonUnit('мс')).toBe('ms');
      expect(canonUnit('сек')).toBe('s');
      expect(canonUnit('секунды')).toBe('s');
      expect(canonUnit('мин')).toBe('min');
      expect(canonUnit('%')).toBe('pct');
      expect(canonUnit('пользователей')).toBe('users');
    });

    it('returns null for unknown unit', () => {
      expect(canonUnit('непонятно')).toBeNull();
      expect(canonUnit(undefined)).toBeNull();
    });
  });

  describe('extractConstraints', () => {
    it('extracts upper bounds', () => {
      const c = extractConstraints('Время отклика не более 200 мс.');
      expect(c.length).toBe(1);
      expect(c[0].bound).toBe('upper');
      expect(c[0].value).toBe(200);
      expect(c[0].unit).toBe('ms');
    });

    it('extracts lower bounds', () => {
      const c = extractConstraints('Доступность не менее 99.9%.');
      expect(c.length).toBe(1);
      expect(c[0].bound).toBe('lower');
      expect(c[0].value).toBe(99.9);
      expect(c[0].unit).toBe('pct');
    });
  });

  describe('extractCitations', () => {
    it('matches known regulatory standards from CITATION_CATALOG', () => {
      const c = extractCitations('Система должна соответствовать Приказу ФСТЭК России № 21.');
      expect(c.length).toBe(1);
      expect(c[0].id).toBe('fstek_21');
    });

    it('matches generic citation shape when catalog id is missing', () => {
      const c = extractCitations('В соответствии с ГОСТ 999.999-2099.');
      expect(c.length).toBe(1);
      expect(c[0].id).toBeNull();
    });
  });

  describe('extractModality', () => {
    it('detects must, mustNot, and may', () => {
      const m1 = extractModality('Система должна обеспечивать авторизацию.');
      expect(m1.must).toBe(1);
      expect(m1.mustNot).toBe(0);
      expect(m1.may).toBe(0);

      const m2 = extractModality('Не допускается хранение паролей в открытом виде.');
      expect(m2.mustNot).toBe(1);

      const m3 = extractModality('Система может отправлять уведомления.');
      expect(m3.may).toBe(1);
    });
  });

  describe('Evaluation Fixtures', () => {
    const evalDir = path.resolve(__dirname, 'eval');
    const files = fs
      .readdirSync(evalDir)
      .filter((f) => f.endsWith('.json') && f !== 'gap-refuse-rto.json');

    it('has all 12 required fixtures', () => {
      expect(files.length).toBe(12);
    });

    for (const file of files) {
      it(`runs fixture: ${file}`, () => {
        const raw = fs.readFileSync(path.join(evalDir, file), 'utf-8');
        const fixture = JSON.parse(raw);

        const pack: GroundingPack = fixture.pack;
        const baseline: string[] = fixture.baselineParagraphs || [];
        const draft: string[] = fixture.draftParagraphs || [];
        const expectedCodes: string[] = fixture.expectedFlagCodes || [];
        const expectedSeverities: string[] = fixture.expectedSeverities;

        const flags = detectDraftFlags(pack, baseline, draft);
        const actualCodes = flags.map((f) => f.code);

        expect(actualCodes).toEqual(expectedCodes);

        if (expectedSeverities) {
          const actualSeverities = flags.map((f) => f.severity);
          expect(actualSeverities).toEqual(expectedSeverities);
        }
      });
    }
  });
});
