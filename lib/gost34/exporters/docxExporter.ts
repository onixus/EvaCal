import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  Footer,
  Header,
  convertMillimetersToTwip,
  PageNumber,
} from 'docx';
import { Gost34DocumentAST } from '../types';
import {
  buildGost2104Form2Table,
  buildGost2104Form2aTable,
  buildEskdFrameHeader,
  FRAME_LEFT_MM,
} from './gostFrameBuilder';
import { DEFAULT_GOST34_PROFILE, getDocumentHeadings } from '../standards';
import { getLayoutProfile } from './layout';
import { buildTitlePage } from './titlePage';
import { buildDocumentBody } from './documentBody';
import { createDocxTypography } from './typography';

/**
 * Renders a GOST 34 Document AST into a Microsoft Word (.docx) binary buffer
 * supporting Layout Profiles (gost34-modern, gost34-eskd-frame, plain-corporate).
 */
export async function exportGost34ToDocx(ast: Gost34DocumentAST): Promise<Buffer> {
  const meta = ast.metadata;

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

  const typography = createDocxTypography(layoutProfile);
  const { font, halfPt } = typography;

  const titlePageChildren = buildTitlePage(meta, docTitleText, typography);
  const docBodyElements = buildDocumentBody(ast.sections, layoutProfile, typography);

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

