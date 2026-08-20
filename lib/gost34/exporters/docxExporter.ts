import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
  HeadingLevel,
  Footer,
  Header,
  convertMillimetersToTwip,
  PageNumber,
  TableOfContents,
  VerticalAlign,
} from 'docx';
import { Gost34DocumentAST, Gost34Section, Gost34TableData } from '../types';
import {
  buildGost2104Form2Table,
  buildGost2104Form2aTable,
  buildEskdFrameHeader,
  FRAME_LEFT_MM,
} from './gostFrameBuilder';
import { DEFAULT_GOST34_PROFILE, getDocumentHeadings } from '../standards';
import { getLayoutProfile } from './layout';
import {
  formatTableCaption,
  sanitizeDocText,
  splitNumberedClause,
  toHeadingCase,
} from './textFormat';

/**
 * Renders a GOST 34 Document AST into a Microsoft Word (.docx) binary buffer
 * supporting Layout Profiles (gost34-modern, gost34-eskd-frame, plain-corporate).
 */
export async function exportGost34ToDocx(ast: Gost34DocumentAST): Promise<Buffer> {
  const meta = ast.metadata;
  const sigs = meta.signatures;

  const layoutProfile = getLayoutProfile(meta.layoutProfileId);
  const standardProfile = ast.standardProfile ?? DEFAULT_GOST34_PROFILE;
  const { title: docTitleText } = getDocumentHeadings(standardProfile, meta.docType);

  // Margins in twips from layoutProfile
  const titleMargin = {
    top: convertMillimetersToTwip(layoutProfile.margins.topMm),
    bottom: convertMillimetersToTwip(layoutProfile.margins.bottomMm),
    left: convertMillimetersToTwip(layoutProfile.margins.leftMm),
    right: convertMillimetersToTwip(layoutProfile.margins.rightMm),
    header: convertMillimetersToTwip(10),
    footer: convertMillimetersToTwip(5),
  };

  /**
   * Рамка ЕСКД рисуется VML-фигурой в колонтитуле, а не через `w:pgBorders`:
   * Word не даёт отодвинуть границу страницы дальше 31 пункта от края, из-за
   * чего левое поле подшивки 20 мм по `pgBorders` недостижимо.
   */
  let frameInstance = 0;
  const makeFrameHeaders = () =>
    layoutProfile.showEskdFrames
      ? {
          default: new Header({ children: [buildEskdFrameHeader(frameInstance++)] }),
          first: new Header({ children: [buildEskdFrameHeader(frameInstance++)] }),
        }
      : undefined;

  // Штампы прижимаются к левой линии рамки, а текст отступает от неё внутрь.
  const stampIndentMm = FRAME_LEFT_MM - layoutProfile.margins.leftMm;

  // Ширина полосы набора: таблицы шире неё вылезли бы за рамку и за край листа.
  const contentWidthMm = 210 - layoutProfile.margins.leftMm - layoutProfile.margins.rightMm;

  /**
   * Кегли берутся из профиля: базовый размер — на текст, остальное отсчитывается
   * от него, поэтому смена профиля меняет типографику целиком, а не только поля.
   */
  const font = layoutProfile.fontFamily;
  const halfPt = (deltaPt = 0) => (layoutProfile.fontSizePt + deltaPt) * 2;
  const run = (text: string, opts: { bold?: boolean; deltaPt?: number } = {}) =>
    new TextRun({
      text: sanitizeDocText(text),
      bold: opts.bold,
      font,
      size: halfPt(opts.deltaPt ?? 0),
      color: '000000',
    });

  /**
   * Блок подписи титульного листа: «УТВЕРЖДАЮ» Заказчика и «СОГЛАСОВАНО»
   * Разработчика оформляются одинаково и выравниваются по левому краю листа.
   * Порядок блоков сохраняется прежним: УТВЕРЖДАЮ сверху, СОГЛАСОВАНО — ниже.
   */
  const approvalBlock = (
    heading: string,
    party: string,
    name: string,
    spacingAfter: number,
  ): Paragraph[] => [
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { before: 0, after: 100 },
      children: [run(heading, { bold: true, deltaPt: -2 })],
    }),
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { before: 0, after: 100 },
      children: [run(party, { deltaPt: -2 })],
    }),
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { before: 0, after: 100 },
      children: [run(`_________________ / ${name} /`, { deltaPt: -2 })],
    }),
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { before: 0, after: spacingAfter },
      children: [run(`«_____» ________________ ${meta.year} г.`, { deltaPt: -2 })],
    }),
  ];

  // Title Page Elements
  const titlePageChildren: (Paragraph | Table)[] = [
    // Утверждающая надпись Заказчика — в левом верхнем углу листа
    ...approvalBlock(
      'УТВЕРЖДАЮ',
      `Заказчик: ${meta.customerName}`,
      sigs.customerApprover || 'И.И. Иванов',
      600,
    ),

    // Наименование системы, вид документа и его обозначение под заголовком
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 1200, after: 300 },
      children: [run(meta.fullSystemName.toUpperCase(), { bold: true, deltaPt: 2 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 200, after: 200 },
      children: [run(docTitleText, { bold: true, deltaPt: 4 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 1200 },
      children: [run(meta.documentCode, { bold: true })],
    }),

    // Согласующая надпись Разработчика — тем же левым краем, что и УТВЕРЖДАЮ
    ...approvalBlock(
      'СОГЛАСОВАНО:',
      `Разработчик: ${meta.developerName}`,
      sigs.approver || 'П.П. Петров',
      0,
    ),

    // Город и год — внизу титульного листа, без тире между ними
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 3600, after: 0 },
      children: [run(`${meta.city} ${meta.year}`, { deltaPt: -2 })],
    }),
  ];

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
      heading: level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
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
  const tableNumbering = { body: 0, appendix: 0 };

  const nextTableNumber = (appendixLetter?: string): string => {
    if (appendixLetter) {
      tableNumbering.appendix += 1;
      return `${appendixLetter}.${tableNumbering.appendix}`;
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

  const tocEntries = collectTocEntries(ast.sections).filter((entry) => entry.level <= 3);

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

  ast.sections.forEach((sec) => renderSection(sec));

  /**
   * Без рамок ЕСКД номер страницы печатается сверху по центру, а нумерация
   * основной части начинается со второй страницы (после титульного листа).
   */
  const pageNumberHeader = new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ children: [PageNumber.CURRENT], font, size: halfPt(-2), color: '000000' }),
        ],
      }),
    ],
  });

  const bodyHeaders = layoutProfile.showEskdFrames
    ? makeFrameHeaders()
    : { default: pageNumberHeader };

  const footersConfig = layoutProfile.showEskdFrames
    ? {
        first: new Footer({
          children: [buildGost2104Form2Table(meta, standardProfile, stampIndentMm)],
        }),
        default: new Footer({
          children: [buildGost2104Form2aTable(meta, stampIndentMm)],
        }),
      }
    : undefined;

  /**
   * Гарнитура и кегль профиля закрепляются стилями документа, а не только
   * прогонами текста: иначе Word напечатал бы своим шрифтом по умолчанию всё,
   * что создаёт сам, — строки собираемого оглавления и стили заголовков.
   */
  const paragraphStyleDefaults = {
    run: { font, size: halfPt(), color: '000000' },
  };

  const tocStyles = [1, 2, 3].map((level) => ({
    id: `TOC${level}`,
    name: `toc ${level}`,
    basedOn: 'Normal',
    next: 'Normal',
    quickFormat: true,
    run: { font, size: halfPt(-2), color: '000000' },
  }));

  // Build Word Document
  const doc = new Document({
    styles: {
      default: {
        document: paragraphStyleDefaults,
        heading1: paragraphStyleDefaults,
        heading2: paragraphStyleDefaults,
        heading3: paragraphStyleDefaults,
        title: paragraphStyleDefaults,
        listParagraph: paragraphStyleDefaults,
        hyperlink: { run: { font, size: halfPt(), color: '000000' } },
      },
      paragraphStyles: tocStyles,
    },
    sections: [
      // Title Section — рамка есть, основной надписи (штампа) на титуле нет
      {
        properties: {
          page: {
            margin: titleMargin,
          },
        },
        headers: makeFrameHeaders(),
        children: titlePageChildren,
      },
      // Main Body Section
      {
        properties: {
          titlePage: layoutProfile.showEskdFrames, // Enables different first page footer only if ESKD frames are on
          page: {
            margin: {
              top: convertMillimetersToTwip(layoutProfile.margins.topMm),
              bottom: convertMillimetersToTwip(layoutProfile.margins.bottomMm),
              left: convertMillimetersToTwip(layoutProfile.margins.leftMm),
              right: convertMillimetersToTwip(layoutProfile.margins.rightMm),
              footer: convertMillimetersToTwip(5),
              header: convertMillimetersToTwip(10),
            },
            pageNumbers: { start: 2 },
          },
        },
        headers: bodyHeaders,
        footers: footersConfig,
        children: docBodyElements,
      },
    ],
  });

  return await Packer.toBuffer(doc);
}
