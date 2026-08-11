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
  HeadingLevel,
  Footer,
  Header,
  convertMillimetersToTwip,
  PageNumber,
  TableOfContents,
} from 'docx';
import { Gost34DocumentAST, Gost34Section } from '../types';
import {
  buildGost2104Form2Table,
  buildGost2104Form2aTable,
  buildEskdFrameHeader,
  FRAME_LEFT_MM,
} from './gostFrameBuilder';
import { DEFAULT_GOST34_PROFILE, getDocumentHeadings } from '../standards';
import { getLayoutProfile } from './layout';

/**
 * Renders a GOST 34 Document AST into a Microsoft Word (.docx) binary buffer
 * supporting Layout Profiles (gost34-modern, gost34-eskd-frame, plain-corporate).
 */
export async function exportGost34ToDocx(ast: Gost34DocumentAST): Promise<Buffer> {
  const meta = ast.metadata;
  const sigs = meta.signatures;

  const layoutProfile = getLayoutProfile(meta.layoutProfileId);
  const standardProfile = ast.standardProfile ?? DEFAULT_GOST34_PROFILE;
  const { title: docTitleText, subtitle: docSubtitleText } = getDocumentHeadings(
    standardProfile,
    meta.docType,
  );

  // Margins in twips from layoutProfile
  const titleMargin = {
    top: convertMillimetersToTwip(layoutProfile.margins.topMm),
    bottom: convertMillimetersToTwip(layoutProfile.margins.bottomMm),
    left: convertMillimetersToTwip(layoutProfile.margins.leftMm),
    right: convertMillimetersToTwip(layoutProfile.margins.rightMm),
    header: convertMillimetersToTwip(5),
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

  // Title Page Elements
  const titlePageChildren: (Paragraph | Table)[] = [
    // Top Approval Header (УТВЕРЖДАЮ / СОГЛАСОВАНО)
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { before: 200, after: 100 },
      children: [
        new TextRun({
          text: 'УТВЕРЖДАЮ',
          bold: true,
          font,
          size: halfPt(-2),
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { before: 0, after: 100 },
      children: [
        new TextRun({
          text: `Заказчик: ${meta.customerName}`,
          font,
          size: halfPt(-2),
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { before: 0, after: 100 },
      children: [
        new TextRun({
          text: `_________________ / ${sigs.customerApprover || 'И.И. Иванов'} /`,
          font,
          size: halfPt(-2),
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { before: 0, after: 600 },
      children: [
        new TextRun({
          text: `«_____» ________________ ${meta.year} г.`,
          font,
          size: halfPt(-2),
        }),
      ],
    }),

    // Document Code & Title
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 1200, after: 300 },
      children: [
        new TextRun({
          text: meta.documentCode,
          bold: true,
          font,
          size: halfPt(),
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 200, after: 300 },
      children: [
        new TextRun({
          text: meta.fullSystemName.toUpperCase(),
          bold: true,
          font,
          size: halfPt(2),
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 200, after: 1200 },
      children: [
        new TextRun({
          text: docTitleText,
          bold: true,
          font,
          size: halfPt(4),
        }),
        new TextRun({
          text: `\n${docSubtitleText}`,
          font,
          size: halfPt(-2),
        }),
      ],
    }),

    // Developer Approval Block
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { before: 600, after: 100 },
      children: [
        new TextRun({
          text: 'СОГЛАСОВАНО:',
          bold: true,
          font,
          size: halfPt(-2),
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { before: 0, after: 100 },
      children: [
        new TextRun({
          text: `Разработчик: ${meta.developerName}`,
          font,
          size: halfPt(-2),
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { before: 0, after: 100 },
      children: [
        new TextRun({
          text: `_________________ / ${sigs.approver || 'П.П. Петров'} /`,
          font,
          size: halfPt(-2),
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { before: 0, after: 600 },
      children: [
        new TextRun({
          text: `«_____» ________________ ${meta.year} г.`,
          font,
          size: halfPt(-2),
        }),
      ],
    }),

    // City & Year
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 800, after: 400 },
      children: [
        new TextRun({
          text: `${meta.city} — ${meta.year}`,
          font,
          size: halfPt(-2),
        }),
      ],
    }),
  ];

  // Helper to build GOST paragraph
  const makeGostParagraph = (text: string): Paragraph => {
    return new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      spacing: { line: 360, after: 120 }, // 1.5 line spacing
      indent: { firstLine: convertMillimetersToTwip(12.5) }, // 1.25 cm indent
      children: [
        new TextRun({
          text,
          font,
          size: halfPt(),
        }),
      ],
    });
  };

  // Helper to build Section Header
  const makeGostHeader = (title: string, numStr: string, level: number = 1): Paragraph => {
    return new Paragraph({
      heading: level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
      spacing: { before: 360, after: 200 },
      indent: { firstLine: convertMillimetersToTwip(12.5) },
      children: [
        new TextRun({
          text: `${numStr}. ${title}`,
          bold: true,
          font,
          size: level === 1 ? halfPt(2) : halfPt(),
        }),
      ],
    });
  };

  // Process AST Sections
  const docBodyElements: (Paragraph | Table)[] = [];

  const renderSection = (sec: Gost34Section, level: number = 1) => {
    docBodyElements.push(makeGostHeader(sec.title, sec.numStr, level));

    sec.paragraphs.forEach((p) => {
      docBodyElements.push(makeGostParagraph(p));
    });

    if (sec.tables) {
      sec.tables.forEach((tbl) => {
        if (tbl.caption) {
          docBodyElements.push(
            new Paragraph({
              alignment: AlignmentType.LEFT,
              spacing: { before: 200, after: 100 },
              children: [
                new TextRun({
                  text: tbl.caption,
                  font,
                  size: halfPt(-2),
                  bold: true,
                }),
              ],
            }),
          );
        }

        const tableRows = [
          // Header Row
          new TableRow({
            children: tbl.headers.map(
              (h) =>
                new TableCell({
                  children: [
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      spacing: { before: 60, after: 60 },
                      children: [
                        new TextRun({
                          text: h,
                          bold: true,
                          font,
                          size: halfPt(-3),
                        }),
                      ],
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
                          children: [
                            new TextRun({
                              text: String(val),
                              font,
                              size: halfPt(-3),
                            }),
                          ],
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
      });
    }

    if (sec.subsections) {
      sec.subsections.forEach((sub) => renderSection(sub, level + 1));
    }
  };

  // Add Table of Contents if enabled in Layout Profile
  if (layoutProfile.includeTOC) {
    docBodyElements.unshift(
      // Без стиля заголовка: иначе Word соберёт сам заголовок «СОДЕРЖАНИЕ»
      // первой строкой создаваемого тут же оглавления.
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 200, after: 300 },
        children: [
          new TextRun({
            text: 'СОДЕРЖАНИЕ',
            bold: true,
            font,
            size: halfPt(2),
          }),
        ],
      }),
      new TableOfContents('СОДЕРЖАНИЕ', {
        hyperlink: true,
        headingStyleRange: '1-3',
      }) as any,
      new Paragraph({
        spacing: { before: 400, after: 400 },
        children: [],
      }),
    );
  }

  ast.sections.forEach((sec) => renderSection(sec));

  // Determine Footers based on Layout Profile
  const footersConfig = layoutProfile.showEskdFrames
    ? {
        first: new Footer({
          children: [buildGost2104Form2Table(meta, standardProfile, stampIndentMm)],
        }),
        default: new Footer({
          children: [buildGost2104Form2aTable(meta, stampIndentMm)],
        }),
      }
    : {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              spacing: { before: 100 },
              children: [
                new TextRun({
                  text: 'Страница ',
                  font: layoutProfile.fontFamily,
                  size: 20,
                }),
                new TextRun({
                  children: [PageNumber.CURRENT],
                  font: layoutProfile.fontFamily,
                  size: 20,
                }),
                new TextRun({
                  text: ' из ',
                  font: layoutProfile.fontFamily,
                  size: 20,
                }),
                new TextRun({
                  children: [PageNumber.TOTAL_PAGES],
                  font: layoutProfile.fontFamily,
                  size: 20,
                }),
              ],
            }),
          ],
        }),
      };

  // Build Word Document
  const doc = new Document({
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
              header: convertMillimetersToTwip(5),
            },
          },
        },
        headers: makeFrameHeaders(),
        footers: footersConfig,
        children: docBodyElements,
      },
    ],
  });

  return await Packer.toBuffer(doc);
}
