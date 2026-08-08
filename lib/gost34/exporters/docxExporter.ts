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
  convertMillimetersToTwip,
  BorderStyle,
  PageBorderOffsetFrom,
  PageBorderDisplay,
} from 'docx';
import { Gost34DocumentAST, Gost34Section } from '../types';
import { buildGost2104Form2Table, buildGost2104Form2aTable } from './gostFrameBuilder';
import { DEFAULT_GOST34_PROFILE, getDocumentHeadings } from '../standards';

/**
 * Renders a GOST 34 Document AST into a Microsoft Word (.docx) binary buffer
 * using strict GOST 7.32-2017 / GOST 2.104-2006 / GOST 2.105-95 formatting rules:
 * - Title Page Margins: Left 20mm, Right 10mm, Top 15mm, Bottom 15mm
 * - Main Body Margins: Left 20mm, Right 10mm, Top 15mm, Bottom 45mm (leaves room for Form 2/2a stamps)
 * - Outer GOST page frame: offsetFrom PAGE with valid point offsets
 * - Typography: Times New Roman, 14pt (28 dxa), 1.5 line spacing, 1.25cm indent
 * - GOST 2.104 Form 2 (Sheet 1 bottom footer) & Form 2a (Subsequent sheets bottom footer)
 */
export async function exportGost34ToDocx(ast: Gost34DocumentAST): Promise<Buffer> {
  const meta = ast.metadata;
  const sigs = meta.signatures;

  const standardProfile = ast.standardProfile ?? DEFAULT_GOST34_PROFILE;
  const { title: docTitleText, subtitle: docSubtitleText } = getDocumentHeadings(standardProfile, meta.docType);

  // Outer GOST Page Frame Border (offsetFrom PAGE with valid OpenXML point spaces: 14pt ~ 5mm, 31pt ~ 11mm)
  const gostBordersConfig = {
    pageBorders: {
      display: PageBorderDisplay.ALL_PAGES,
      offsetFrom: PageBorderOffsetFrom.PAGE,
    },
    pageBorderTop: { style: BorderStyle.SINGLE, size: 12, color: '000000', space: 14 },
    pageBorderBottom: { style: BorderStyle.SINGLE, size: 12, color: '000000', space: 14 },
    pageBorderLeft: { style: BorderStyle.SINGLE, size: 12, color: '000000', space: 31 },
    pageBorderRight: { style: BorderStyle.SINGLE, size: 12, color: '000000', space: 14 },
  };

  // Title Page Elements
  const titlePageChildren: (Paragraph | Table)[] = [
    // Top Approval Header (УТВЕРЖДАЮ / СОГЛАСОВАНО)
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { before: 200, after: 100 },
      children: [new TextRun({ text: 'УТВЕРЖДАЮ', bold: true, font: 'Times New Roman', size: 24 })],
    }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { before: 0, after: 100 },
      children: [
        new TextRun({
          text: `Заказчик: ${meta.customerName}`,
          font: 'Times New Roman',
          size: 24,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { before: 0, after: 100 },
      children: [
        new TextRun({
          text: `_________________ / ${sigs.customerApprover || 'И.И. Иванов'} /`,
          font: 'Times New Roman',
          size: 24,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { before: 0, after: 600 },
      children: [
        new TextRun({
          text: `«_____» ________________ ${meta.year} г.`,
          font: 'Times New Roman',
          size: 24,
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
          font: 'Times New Roman',
          size: 28,
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
          font: 'Times New Roman',
          size: 32,
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
          font: 'Times New Roman',
          size: 36,
        }),
        new TextRun({
          text: `\n${docSubtitleText}`,
          font: 'Times New Roman',
          size: 24,
        }),
      ],
    }),

    // Developer Approval Block
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { before: 600, after: 100 },
      children: [new TextRun({ text: 'СОГЛАСОВАНО:', bold: true, font: 'Times New Roman', size: 24 })],
    }),
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { before: 0, after: 100 },
      children: [
        new TextRun({
          text: `Разработчик: ${meta.developerName}`,
          font: 'Times New Roman',
          size: 24,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { before: 0, after: 100 },
      children: [
        new TextRun({
          text: `_________________ / ${sigs.approver || 'П.П. Петров'} /`,
          font: 'Times New Roman',
          size: 24,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { before: 0, after: 600 },
      children: [
        new TextRun({
          text: `«_____» ________________ ${meta.year} г.`,
          font: 'Times New Roman',
          size: 24,
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
          font: 'Times New Roman',
          size: 24,
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
          font: 'Times New Roman',
          size: 28, // 14pt
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
          font: 'Times New Roman',
          size: level === 1 ? 32 : 28, // 16pt for H1, 14pt for H2
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
                  font: 'Times New Roman',
                  size: 24,
                  bold: true,
                }),
              ],
            })
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
                          font: 'Times New Roman',
                          size: 22,
                        }),
                      ],
                    }),
                  ],
                })
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
                              font: 'Times New Roman',
                              size: 22,
                            }),
                          ],
                        }),
                      ],
                    })
                ),
              })
          ),
        ];

        docBodyElements.push(
          new Table({
            width: { size: convertMillimetersToTwip(185), type: WidthType.DXA },
            rows: tableRows,
          })
        );
      });
    }

    if (sec.subsections) {
      sec.subsections.forEach((sub) => renderSection(sub, level + 1));
    }
  };

  ast.sections.forEach((sec) => renderSection(sec));

  // Build Word Document with exact GOST 2.104 frames and section page properties
  const doc = new Document({
    sections: [
      // Title Section (No Stamp Footer)
      {
        properties: {
          page: {
            margin: {
              top: convertMillimetersToTwip(15),
              bottom: convertMillimetersToTwip(15),
              left: convertMillimetersToTwip(20),
              right: convertMillimetersToTwip(10),
            },
            borders: gostBordersConfig as any,
          },
        },
        children: titlePageChildren,
      },
      // Main Body Section (Form 2 on Sheet 1, Form 2a on subsequent sheets)
      {
        properties: {
          titlePage: true, // Enables different first page header/footer!
          page: {
            margin: {
              top: convertMillimetersToTwip(15),
              bottom: convertMillimetersToTwip(45), // 45mm bottom margin leaves room for 40mm Form 2 stamp
              left: convertMillimetersToTwip(20),
              right: convertMillimetersToTwip(10),
              footer: convertMillimetersToTwip(5),
              header: convertMillimetersToTwip(5),
            },
            borders: gostBordersConfig as any,
          },
        },
        footers: {
          first: new Footer({
            children: [buildGost2104Form2Table(meta, standardProfile)],
          }),
          default: new Footer({
            children: [buildGost2104Form2aTable(meta)],
          }),
        },
        children: docBodyElements,
      },
    ],
  });

  return await Packer.toBuffer(doc);
}
