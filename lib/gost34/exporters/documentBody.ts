import { Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle, HeadingLevel, convertMillimetersToTwip, TableOfContents, VerticalAlign } from 'docx';
import type { Gost34Section, Gost34TableData } from '../types';
import type { LayoutProfile } from './layout';
import type { DocxTypography } from './typography';
import { formatTableCaption, sanitizeDocText, splitNumberedClause, toHeadingCase } from './textFormat';

export function buildDocumentBody(sections: Gost34Section[], layoutProfile: LayoutProfile, { run }: DocxTypography): (Paragraph | Table)[] {
  const contentWidthMm = 210 - layoutProfile.margins.leftMm - layoutProfile.margins.rightMm;
  // Helper to build GOST paragraph
  const makeGostParagraph = (text: string): Paragraph => {
    const clause = splitNumberedClause(text);

    /**
     * Нумерованные пункты («1.3 Обозначение документа: …») оформляются по
     * образцу подразделов: номер у левого поля, текст с висячим отступом.
     */
    if (clause) {
      return new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        spacing: { line: 360, after: 120 },
        indent: { left: convertMillimetersToTwip(12.5), hanging: convertMillimetersToTwip(12.5) },
        children: [run(`${clause.number} `, { bold: true }), run(clause.rest)],
      });
    }

    return new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      spacing: { line: 360, after: 120 }, // 1.5 line spacing
      indent: { firstLine: convertMillimetersToTwip(12.5) }, // 1.25 cm indent
      children: [run(text)],
    });
  };

  /**
   * Заголовок раздела: без точки после номера, строчными буквами с прописной,
   * чёрным шрифтом. Разделы первого уровня начинаются с новой страницы.
   */
  const makeGostHeader = (title: string, numStr: string, level: number = 1): Paragraph => {
    const isAppendix = numStr.startsWith('Приложение');
    const heading = toHeadingCase(title);

    // Приложение: обозначение и наименование — на отдельных строках
    const children = isAppendix
      ? [
          run(numStr, { bold: true, deltaPt: 2 }),
          new TextRun({ break: 1 }),
          run(heading, { bold: true, deltaPt: 2 }),
        ]
      : [run(`${numStr} ${heading}`, { bold: true, deltaPt: level === 1 ? 2 : 0 })];

    return new Paragraph({
      heading: level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
      alignment: isAppendix ? AlignmentType.CENTER : AlignmentType.LEFT,
      pageBreakBefore: level === 1,
      spacing: { before: level === 1 ? 0 : 360, after: 240 },
      keepNext: true,
      children,
    });
  };

  // Process AST Sections
  const docBodyElements: (Paragraph | Table)[] = [];

  /** Сквозная нумерация таблиц: в основной части — числом, в приложении — «А.1». */
  const tableNumbering = { body: 0, appendices: new Map<string, number>() };

  const nextTableNumber = (appendixLetter?: string): string => {
    if (appendixLetter) {
      const number = (tableNumbering.appendices.get(appendixLetter) || 0) + 1;
      tableNumbering.appendices.set(appendixLetter, number);
      return `${appendixLetter}.${number}`;
    }
    tableNumbering.body += 1;
    return String(tableNumbering.body);
  };

  const renderTable = (tbl: Gost34TableData, appendixLetter?: string) => {
    // Пустая строка перед наименованием отделяет таблицу от предыдущей
    docBodyElements.push(new Paragraph({ spacing: { before: 0, after: 0 }, children: [] }));

    docBodyElements.push(
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { before: 0, after: 100 },
        keepNext: true,
        // Наименование таблицы полужирным не выделяется
        children: [
          run(formatTableCaption(nextTableNumber(appendixLetter), tbl.caption), {
            deltaPt: -2,
          }),
        ],
      }),
    );

    const tableRows = [
      // Строка заголовка: повторяется на каждой странице, отделена двойной чертой
      new TableRow({
        tableHeader: true,
        cantSplit: true,
        children: tbl.headers.map(
          (h) =>
            new TableCell({
              verticalAlign: VerticalAlign.CENTER,
              borders: {
                bottom: { style: BorderStyle.DOUBLE, size: 6, color: '000000' },
              },
              shading: layoutProfile.tableHeaderBgColor
                ? { fill: layoutProfile.tableHeaderBgColor }
                : undefined,
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { before: 60, after: 60 },
                  children: [run(h, { bold: true, deltaPt: -3 })],
                }),
              ],
            }),
        ),
      }),
      // Data Rows
      ...tbl.rows.map(
        (row) =>
          new TableRow({
            children: row.map(
              (val) =>
                new TableCell({
                  children: [
                    new Paragraph({
                      alignment: AlignmentType.LEFT,
                      spacing: { before: 40, after: 40 },
                      children: [run(String(val), { deltaPt: -3 })],
                    }),
                  ],
                }),
            ),
          }),
      ),
    ];

    docBodyElements.push(
      new Table({
        width: { size: convertMillimetersToTwip(contentWidthMm), type: WidthType.DXA },
        rows: tableRows,
      }),
    );
  };

  const renderSection = (sec: Gost34Section, level: number = 1, appendixLetter?: string) => {
    const letter =
      appendixLetter ??
      (sec.numStr.startsWith('Приложение')
        ? sec.numStr.replace('Приложение', '').trim()
        : undefined);

    docBodyElements.push(makeGostHeader(sec.title, sec.numStr, level));

    sec.paragraphs.forEach((p) => {
      docBodyElements.push(makeGostParagraph(p));
    });

    sec.tables?.forEach((tbl) => renderTable(tbl, letter));

    sec.subsections?.forEach((sub) => renderSection(sub, level + 1, letter));
  };

  /** Перечень разделов для готового содержимого поля оглавления. */
  const collectTocEntries = (
    sections: Gost34Section[],
    level = 1,
  ): Array<{ title: string; level: number }> =>
    sections.flatMap((sec) => [
      {
        title: sanitizeDocText(
          sec.numStr.startsWith('Приложение')
            ? `${sec.numStr}. ${toHeadingCase(sec.title)}`
            : `${sec.numStr} ${toHeadingCase(sec.title)}`,
        ),
        level,
      },
      ...collectTocEntries(sec.subsections || [], level + 1),
    ]);

  const tocEntries = collectTocEntries(sections).filter((entry) => entry.level <= 3);

  // Add Table of Contents if enabled in Layout Profile
  if (layoutProfile.includeTOC) {
    docBodyElements.unshift(
      // Без стиля заголовка: иначе Word соберёт сам заголовок «СОДЕРЖАНИЕ»
      // первой строкой создаваемого тут же оглавления.
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 200, after: 300 },
        children: [run('СОДЕРЖАНИЕ', { bold: true, deltaPt: 2 })],
      }),
      /**
       * `beginDirty: false` — поле оглавления не помечается требующим
       * обновления, иначе Word при открытии файла спрашивает про обновление
       * внешних связей. Чтобы оглавление не было пустым до нажатия F9,
       * в поле кладётся готовый перечень разделов.
       */
      new TableOfContents('СОДЕРЖАНИЕ', {
        hyperlink: true,
        headingStyleRange: '1-3',
        beginDirty: false,
        cachedEntries: tocEntries,
      }) as any,
    );
  }

  sections.forEach((sec) => renderSection(sec));

  return docBodyElements;
}
