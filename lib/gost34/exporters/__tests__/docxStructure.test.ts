import { describe, it, expect, beforeAll } from 'vitest';
import JSZip from 'jszip';
import { analyzeAndNormalizeInput } from '../../analyzer';
import { buildGost34DocumentAST } from '../../generator';
import { exportGost34ToDocx } from '../docxExporter';
import { CURRENT_GOST34_PROFILE_ID, LEGACY_GOST34_PROFILE_ID } from '../../standards';
import { GOLDEN_SCENARIOS } from '../../__tests__/golden/scenarios';
import type { GostDocumentType } from '../../types';
import { formatTableCaption, sanitizeDocText, toHeadingCase } from '../textFormat';

/**
 * Структурные проверки Word-файла (этап 12 плана): заголовки, таблицы,
 * нумерация, приложения, титульный лист и отсутствие ссылок прежней редакции
 * в документах действующего профиля.
 *
 * Документ собирается из контрольного сценария, а не из синтетического AST:
 * проверяется тот же путь, которым файл получает Заказчик.
 */

const KII_SCENARIO = GOLDEN_SCENARIOS.find((s) => s.id === 'kii')!;
const LEGACY_SCENARIO = GOLDEN_SCENARIOS.find((s) => s.id === 'legacy-gost34-602-89')!;

async function buildDocumentXml(
  scenario: typeof KII_SCENARIO,
  options: { docType?: GostDocumentType; layoutProfileId?: 'gost34-modern' } = {},
) {
  const payload = analyzeAndNormalizeInput({
    calculation: scenario.calculation,
    projectContext: scenario.projectContext,
    metadataOverride: {
      docType: options.docType || scenario.docType,
      standardProfileId: scenario.standardProfileId,
      layoutProfileId: options.layoutProfileId,
      enrichRequirements: true,
    },
  });
  const ast = buildGost34DocumentAST(payload);
  const zip = await JSZip.loadAsync(await exportGost34ToDocx(ast));
  return {
    ast,
    payload,
    zip,
    xml: await zip.file('word/document.xml')!.async('string'),
  };
}

/** Видимый текст документа: содержимое всех текстовых прогонов подряд. */
function visibleText(documentXml: string): string {
  return [...documentXml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map((match) => match[1])
    .join('\n')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

describe('Структура Word-документа ГОСТ 34', () => {
  let xml = '';
  let text = '';
  let scenarioAst: Awaited<ReturnType<typeof buildDocumentXml>>['ast'];

  beforeAll(async () => {
    const built = await buildDocumentXml(KII_SCENARIO, { layoutProfileId: 'gost34-modern' });
    xml = built.xml;
    text = visibleText(built.xml);
    scenarioAst = built.ast;
  });

  it('размечает разделы и подразделы стилями заголовков', () => {
    expect(xml).toContain('<w:pStyle w:val="Heading1"/>');
    expect(xml).toContain('<w:pStyle w:val="Heading2"/>');

    const headingCount = (xml.match(/<w:pStyle w:val="Heading1"\/>/g) || []).length;
    const topLevelSections = scenarioAst.sections.length;
    expect(headingCount).toBe(topLevelSections);
  });

  it('печатает разделы без точки после номера и строчными буквами', () => {
    for (const section of scenarioAst.sections) {
      if (section.numStr.startsWith('Приложение')) {
        // Приложение: обозначение и наименование печатаются отдельными строками
        expect(text, section.title).toContain(section.numStr);
        expect(text, section.title).toContain(sanitizeDocText(toHeadingCase(section.title)));
        continue;
      }
      expect(text, `раздел «${section.title}»`).toContain(
        sanitizeDocText(`${section.numStr} ${toHeadingCase(section.title)}`),
      );
    }
    expect(text).not.toMatch(/(?:^|\n)\d+\. [А-Я]{4}/);
  });

  it('не печатает букву «ё» в тексте документа', () => {
    expect(text).not.toMatch(/[ёЁ]/);
  });

  it('начинает каждый раздел первого уровня с новой страницы', () => {
    const pageBreaks = (xml.match(/<w:pageBreakBefore\/>/g) || []).length;
    expect(pageBreaks).toBe(scenarioAst.sections.length);
  });

  it('нумерует пункты внутри разделов номером раздела', () => {
    const numberedItem = /(?:^|\n)\d+\.\d+ \S/.test(text);
    expect(numberedItem).toBe(true);
  });

  it('выводит приложения отдельной нумерацией «Приложение А»', () => {
    const appendices = scenarioAst.sections.filter((s) => s.numStr.startsWith('Приложение'));
    expect(appendices.length).toBeGreaterThan(0);
    expect(text).toContain('Приложение А');
  });

  it('строит таблицы разделов с заголовками столбцов', () => {
    const tables = scenarioAst.sections.flatMap((s) => [
      ...(s.tables || []),
      ...(s.subsections || []).flatMap((sub) => sub.tables || []),
    ]);
    expect(tables.length).toBeGreaterThan(0);
    expect((xml.match(/<w:tbl>/g) || []).length).toBeGreaterThanOrEqual(tables.length);

    // Наименование таблицы: «Т а б л и ц а N – …», строка заголовка повторяется
    expect(text).toContain(formatTableCaption('1', tables[0].caption));
    expect((xml.match(/<w:tblHeader\/>/g) || []).length).toBeGreaterThanOrEqual(tables.length);
    expect(xml).toContain('<w:bottom w:val="double" w:color="000000" w:sz="6"/>');

    for (const table of tables) {
      if (table.caption) {
        expect(text, table.caption).toContain(sanitizeDocText(table.caption));
      }
      for (const header of table.headers) {
        expect(text, header).toContain(sanitizeDocText(header));
      }
    }
  });

  it('содержит титульный лист с обозначением документа, Заказчиком и городом', () => {
    const meta = scenarioAst.metadata;
    expect(text).toContain(meta.documentCode);
    expect(text).toContain(meta.fullSystemName.toUpperCase());
    expect(text).toContain(`Заказчик: ${meta.customerName}`);
    expect(text).toContain(`Разработчик: ${meta.developerName}`);
    expect(text).toContain(`${meta.city} ${meta.year}`);
    expect(text).not.toContain(`${meta.city} — ${meta.year}`);
    expect(text).toContain('УТВЕРЖДАЮ');
  });

  it('печатает весь документ одной гарнитурой профиля оформления', async () => {
    const built = await buildDocumentXml(KII_SCENARIO, { layoutProfileId: 'gost34-modern' });
    const parts = Object.keys(built.zip.files).filter((n) =>
      /^word\/(document|styles|header\d+|footer\d+)\.xml$/.test(n),
    );
    const fonts = new Set<string>();
    for (const name of parts) {
      const partXml = await built.zip.file(name)!.async('string');
      for (const match of partXml.matchAll(/w:ascii="([^"]+)"/g)) fonts.add(match[1]);
    }

    // Ни один прогон, включая создаваемое Word'ом оглавление, не уходит на Calibri
    expect([...fonts]).toEqual(['Times New Roman']);
  });

  it('выравнивает надписи титульного листа по левому краю в прежнем порядке', () => {
    const meta = scenarioAst.metadata;
    const approve = text.indexOf('УТВЕРЖДАЮ');
    const agree = text.indexOf('СОГЛАСОВАНО:');
    const city = text.indexOf(`${meta.city} ${meta.year}`);

    expect(approve).toBeGreaterThanOrEqual(0);
    // УТВЕРЖДАЮ сверху, СОГЛАСОВАНО ниже заголовка, город и год — последними
    expect(agree).toBeGreaterThan(approve);
    expect(city).toBeGreaterThan(agree);

    // Обе надписи набраны у левого края: выравнивание вправо на титуле не задаётся
    const titlePage = xml.slice(0, xml.indexOf('СОДЕРЖАНИЕ'));
    expect(titlePage).not.toContain('<w:jc w:val="right"/>');
  });

  it('собирает оглавление полем TOC по стилям заголовков', () => {
    expect(text).toContain('СОДЕРЖАНИЕ');
    // Оглавление собирается Word'ом по стилям заголовков 1–3, а не печатается списком
    expect(xml).toContain('TOC \\h \\o &quot;1-3&quot;');
  });

  it('не просит обновлять связи при открытии и показывает разделы до обновления поля', () => {
    // Поле, помеченное «грязным», заставляет Word спрашивать про внешние связи
    expect(xml).not.toContain('w:dirty="true"');

    // До нажатия F9 в поле оглавления лежит готовый перечень разделов
    const tocField = xml.slice(xml.indexOf('TOC \\h'), xml.indexOf('<w:fldCharType="end"'));
    for (const section of scenarioAst.sections.slice(0, 3)) {
      expect(tocField, section.title).toContain(
        sanitizeDocText(`${section.numStr} ${toHeadingCase(section.title)}`),
      );
    }
  });

  it('не оставляет ссылок прежней редакции в документе действующего профиля', () => {
    expect(scenarioAst.standardProfile?.id).toBe(CURRENT_GOST34_PROFILE_ID);

    for (const legacyCitation of [
      'ГОСТ 34.602-89',
      'ГОСТ 34.201-89',
      'ГОСТ 34.601-90',
      'РД 50-34.698-90',
    ]) {
      expect(text, legacyCitation).not.toContain(sanitizeDocText(legacyCitation));
    }

    expect(text).toContain(sanitizeDocText('ГОСТ 34.602-2020'));
  });

  it('сохраняет ссылки прежней редакции в документе legacy-профиля', async () => {
    const legacy = await buildDocumentXml(LEGACY_SCENARIO, { layoutProfileId: 'gost34-modern' });
    const legacyText = visibleText(legacy.xml);

    expect(legacy.ast.standardProfile?.id).toBe(LEGACY_GOST34_PROFILE_ID);
    expect(legacyText).toContain(sanitizeDocText('ГОСТ 34.602-89'));
    expect(legacyText).not.toContain(sanitizeDocText('ГОСТ 34.602-2020'));
  });

  it.each<GostDocumentType>(['PZ', 'AF', 'PMI', 'SPEC'])(
    'печатает документ %s с заголовками и содержимым',
    async (docType) => {
      const built = await buildDocumentXml(KII_SCENARIO, {
        docType,
        layoutProfileId: 'gost34-modern',
      });
      const builtText = visibleText(built.xml);

      expect(built.ast.sections.length).toBeGreaterThan(0);
      expect(built.xml).toContain('<w:pStyle w:val="Heading1"/>');
      for (const section of built.ast.sections) {
        expect(builtText, `${docType}: раздел «${section.title}»`).toContain(
          sanitizeDocText(toHeadingCase(section.title)),
        );
      }
    },
  );
});
