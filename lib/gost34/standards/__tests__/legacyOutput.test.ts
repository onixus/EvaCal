import { describe, it, expect } from 'vitest';
import {
  CURRENT_GOST34_PROFILE_ID,
  LEGACY_GOST34_PROFILE_ID,
  getDocumentHeadings,
  getZipEntries,
  resolveGost34Profile,
} from '../index';
import { GostDocumentType } from '../../types';

const legacy = resolveGost34Profile(LEGACY_GOST34_PROFILE_ID);

/**
 * Frozen copy of the title/subtitle pairs that docxExporter produced from its
 * hardcoded switch before the registry existed. If this table ever has to
 * change, the legacy documents change too — which is a bug, not a refactor.
 */
const LEGACY_HEADINGS: Array<[GostDocumentType, string, string]> = [
  ['TZ', 'ТЕХНИЧЕСКОЕ ЗАДАНИЕ', '(ГОСТ 34.602-89)'],
  ['PZ', 'ПОЯСНИТЕЛЬНАЯ ЗАПИСКА', '(РД 50-34.698-90 п.2.1)'],
  ['AF', 'ОПИСАНИЕ АВТОМАТИЗИРУЕМЫХ ФУНКЦИЙ', '(РД 50-34.698-90 п.2.2)'],
  ['PMI', 'ПРОГРАММА И МЕТОДИКА ИСПЫТАНИЙ', '(РД 50-34.698-90 п.2.7)'],
  ['SPEC', 'СПЕЦИФИКАЦИЯ ОБОРУДОВАНИЯ И ПО', '(ГОСТ 34.201-89 / РД 50-34.698-90 п.2.8)'],
];

/** Frozen copy of the ZIP filenames the export route produced before the registry. */
const LEGACY_ZIP_FILENAMES = [
  '01_TZ_Техническое_задание_ГОСТ_34.602-89.docx',
  '02_PZ_Пояснительная_записка_РД_50-34.698-90.docx',
  '03_AF_Описание_функций_РД_50-34.698-90.docx',
  '04_PMI_Программа_и_методика_испытаний_РД_50-34.698-90.docx',
  '05_SPEC_Спецификация_оборудования_и_ПО_ГОСТ_34.201-89.docx',
];

describe('legacy profile output is unchanged', () => {
  it.each(LEGACY_HEADINGS)('%s heading', (docType, title, subtitle) => {
    expect(getDocumentHeadings(legacy, docType)).toEqual({ title, subtitle });
  });

  it('produces the same ZIP entry names', () => {
    expect(getZipEntries(legacy).map((e) => e.filename)).toEqual(LEGACY_ZIP_FILENAMES);
  });

  it('orders ZIP entries by zipOrder', () => {
    expect(getZipEntries(legacy).map((e) => e.docType)).toEqual(['TZ', 'PZ', 'AF', 'PMI', 'SPEC']);
  });
});

describe('current profile', () => {
  const current = resolveGost34Profile(CURRENT_GOST34_PROFILE_ID);

  it('keeps the same document titles but cites current standards', () => {
    for (const [docType, title] of LEGACY_HEADINGS) {
      const headings = getDocumentHeadings(current, docType);
      expect(headings.title).toBe(title);
      expect(headings.subtitle).not.toMatch(/-89|-90/);
    }
  });

  it('is marked preview until the 2020 structure lands', () => {
    expect(current.status).toBe('preview');
  });
});
