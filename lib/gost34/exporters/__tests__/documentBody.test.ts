import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { exportGost34ToDocx } from '../docxExporter';
import { prepareGost34Document } from '../../generation/prepareDocument';
import { formatTableCaption } from '../textFormat';
import type { Gost34Section } from '../../types';

const section = (id: string, numStr: string, subsections?: Gost34Section[]): Gost34Section => ({
  id,
  numStr,
  title: id,
  paragraphs: ['Text'],
  subsections,
});

it('preserves level-three heading styles in Word', async () => {
  const { ast } = prepareGost34Document({
    metadataOverride: { layoutProfileId: 'plain-corporate' },
  });
  ast.sections = [
    section('Root', '1', [section('Child', '1.1', [section('Grandchild', '1.1.1')])]),
  ];
  const zip = await JSZip.loadAsync(await exportGost34ToDocx(ast));
  const xml = await zip.file('word/document.xml')!.async('string');
  expect(xml).toMatch(/<w:pStyle w:val="Heading3"\/>/);
  expect((xml.match(/<w:pStyle w:val="Heading2"\/>/g) || []).length).toBe(1);
});

describe('Independent table counters', () => {
  it.each(['gost34-modern', 'gost34-eskd-frame', 'plain-corporate'] as const)(
    'restarts numbering for each appendix in %s',
    async (layoutProfileId) => {
      const { ast } = prepareGost34Document({ metadataOverride: { layoutProfileId } });
      const table = { caption: 'Data', headers: ['Column'], rows: [['Value']] };
      ast.sections = [
        { ...section('Body', '1'), tables: [table] },
        { ...section('AppendixA', 'Приложение А'), tables: [table, table] },
        { ...section('AppendixB', 'Приложение Б'), tables: [table] },
      ];
      const zip = await JSZip.loadAsync(await exportGost34ToDocx(ast));
      const xml = await zip.file('word/document.xml')!.async('string');
      for (const number of ['1', 'А.1', 'А.2', 'Б.1']) {
        expect(xml).toContain(formatTableCaption(number, 'Data'));
      }
      expect(xml).not.toContain(formatTableCaption('Б.3', 'Data'));
    },
  );
});
