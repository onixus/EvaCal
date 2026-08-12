import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GOLDEN_SCENARIOS } from './golden/scenarios';
import { buildGoldenSnapshot } from './golden/snapshot';
import { CURRENT_GOST34_PROFILE_ID, LEGACY_GOST34_PROFILE_ID } from '../standards';
import { TZ_2020_SECTION_TITLES } from '../schema/tz34-2020-sections';

const GOLDEN_DIR = join(__dirname, 'golden');

function readGolden(id: string) {
  return JSON.parse(readFileSync(join(GOLDEN_DIR, `${id}.json`), 'utf8'));
}

describe('Контрольные документы ГОСТ 34', () => {
  it('покрывает все девять типовых сценариев плана модернизации', () => {
    expect(GOLDEN_SCENARIOS.map((s) => s.id)).toEqual([
      'generic-corporate-as',
      'ispdn',
      'kii',
      'bank',
      'nfo',
      'air-gapped-as',
      'high-availability-as',
      'simple-internal-system',
      'legacy-gost34-602-89',
    ]);
  });

  it.each(GOLDEN_SCENARIOS)('сценарий «$title» совпадает с эталоном', (scenario) => {
    const actual = buildGoldenSnapshot(scenario);
    // Расхождение означает изменение структуры документа: если оно
    // намеренное — обновите эталоны через `npx tsx lib/gost34/__tests__/golden/update.ts`.
    expect(actual).toEqual(readGolden(scenario.id));
  });

  it('строит документы действующего профиля по обязательным разделам ГОСТ 34.602-2020', () => {
    const modern = GOLDEN_SCENARIOS.filter(
      (s) => s.standardProfileId === CURRENT_GOST34_PROFILE_ID,
    );
    expect(modern.length).toBe(8);

    for (const scenario of modern) {
      const golden = readGolden(scenario.id);
      const titles: string[] = golden.sections.map((s: { title: string }) => s.title);

      for (const required of TZ_2020_SECTION_TITLES) {
        expect(titles, `${scenario.id}: раздел «${required}»`).toContain(required);
      }
      // Порядок разделов профиля соблюдён: номера идут по возрастанию.
      const numbered = golden.sections
        .filter((s: { numStr: string }) => /^\d+$/.test(s.numStr))
        .map((s: { numStr: string }) => Number(s.numStr));
      expect(numbered).toEqual([...numbered].sort((a, b) => a - b));
    }
  });

  it('не тянет ссылки прежней редакции в документы действующего профиля', () => {
    for (const scenario of GOLDEN_SCENARIOS) {
      const golden = readGolden(scenario.id);
      const expected =
        scenario.standardProfileId === LEGACY_GOST34_PROFILE_ID
          ? 'ГОСТ 34.602-89'
          : 'ГОСТ 34.602-2020';
      expect(golden.profile.primaryStandard, scenario.id).toBe(expected);
    }
  });

  it('признаёт нормативы применимыми там, где контекст даёт основание', () => {
    expect(readGolden('ispdn').applicability.fstek_21).toBe('APPLICABLE');
    expect(readGolden('ispdn').applicability.fz_152).toBe('APPLICABLE');
    expect(readGolden('kii').applicability.fz_187_kii).toBe('APPLICABLE');
    expect(readGolden('kii').applicability.fstek_239).toBe('APPLICABLE');
    expect(readGolden('bank').applicability.cb_683p).toBe('APPLICABLE');
    expect(readGolden('bank').applicability.gost_57580).toBe('APPLICABLE');
    expect(readGolden('nfo').applicability.cb_757p).toBe('APPLICABLE');
    expect(readGolden('high-availability-as').applicability.sla_999).toBe('APPLICABLE');
  });

  it('оставляет неподтверждённые нормативы в UNKNOWN, а не считает их применимыми', () => {
    const simple = readGolden('simple-internal-system').applicability;
    expect(simple.fstek_21).toBe('NOT_APPLICABLE');
    expect(simple.fz_187_kii).toBe('NOT_APPLICABLE');
    expect(Object.values(simple)).toContain('UNKNOWN');
  });
});
