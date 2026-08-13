import {
  Table,
  TableRow,
  TableCell,
  Paragraph,
  TextRun,
  AlignmentType,
  WidthType,
  BorderStyle,
  ImportedXmlComponent,
  PageNumber,
  convertMillimetersToTwip,
} from 'docx';
import { Gost34DocMetadata } from '../types';
import { DEFAULT_GOST34_PROFILE, StandardProfile } from '../standards';

type DocxAlignment = (typeof AlignmentType)[keyof typeof AlignmentType];

/**
 * Геометрия рамки по ГОСТ 2.301-68 для листа A4: слева поле подшивки 20 мм,
 * с остальных сторон — 5 мм. Внутренняя ширина рамки (и штампов) — 185 мм.
 */
export const FRAME_LEFT_MM = 20;
export const FRAME_EDGE_MM = 5;
export const FRAME_WIDTH_MM = 210 - FRAME_LEFT_MM - FRAME_EDGE_MM; // 185 мм
export const FRAME_HEIGHT_MM = 297 - FRAME_EDGE_MM * 2; // 287 мм

const MM_TO_PT = 72 / 25.4;
const pt = (mm: number) => (mm * MM_TO_PT).toFixed(2);

/**
 * Рамка ЕСКД, нарисованная VML-прямоугольником в колонтитуле.
 *
 * Штатные `w:pgBorders` для этого не годятся: Word ограничивает отступ границы
 * от края страницы 31 пунктом (~10,9 мм), поэтому левую линию рамки нельзя
 * отодвинуть на положенные 20 мм. Плавающая VML-фигура, привязанная к странице
 * (`mso-position-*-relative:page`), позволяет задать точную геометрию и не
 * влияет на поток текста.
 */
export function buildEskdFrameHeader(instance = 0): Paragraph {
  // Идентификатор фигуры должен быть уникальным в пределах документа.
  const shapeId = 1026 + instance;
  const rect =
    `<v:rect id="gost_eskd_frame_${instance}" o:spid="_x0000_s${shapeId}" ` +
    `style="position:absolute;` +
    `margin-left:${pt(FRAME_LEFT_MM)}pt;margin-top:${pt(FRAME_EDGE_MM)}pt;` +
    `width:${pt(FRAME_WIDTH_MM)}pt;height:${pt(FRAME_HEIGHT_MM)}pt;` +
    `z-index:-251658240;` +
    `mso-position-horizontal:absolute;mso-position-horizontal-relative:page;` +
    `mso-position-vertical:absolute;mso-position-vertical-relative:page" ` +
    `filled="f" stroked="t" strokecolor="#000000" strokeweight="1.5pt"/>`;

  // Колонтитул с фигурой не должен занимать высоту: строка 1 пункт, шрифт 1 пункт.
  const xml =
    `<w:p>` +
    `<w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/>` +
    `<w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr></w:pPr>` +
    `<w:r><w:rPr><w:noProof/><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr>` +
    `<w:pict>${rect}</w:pict></w:r>` +
    `</w:p>`;

  /**
   * `fromXmlString` возвращает безымянную обёртку (rootKey === undefined) вокруг
   * разобранного элемента. Если отдать её докуметну как есть, в part попадёт
   * незакрытый тег `</undefined>` и Word объявит файл повреждённым — поэтому
   * достаём из обёртки сам `w:p`.
   */
  const wrapper = ImportedXmlComponent.fromXmlString(xml) as unknown as {
    rootKey?: string;
    root: unknown[];
  };
  const paragraph = wrapper.rootKey === undefined ? wrapper.root[0] : wrapper;

  return paragraph as Paragraph;
}

/**
 * Ячейка штампа: либо обычный текст, либо поле Word с номером листа
 * (`PAGE` / `NUMPAGES`) — иначе на всех листах стояли бы одни и те же цифры.
 */
function buildCellRuns(
  text: string,
  opts: { font: string; bold: boolean; size: number; pageField?: 'current' | 'total' },
): TextRun[] {
  const runs: TextRun[] = [];
  const { font, bold, size } = opts;

  if (text) {
    runs.push(new TextRun({ text, font, bold, size }));
  }

  if (opts.pageField) {
    runs.push(
      new TextRun({
        children: [opts.pageField === 'current' ? PageNumber.CURRENT : PageNumber.TOTAL_PAGES],
        font,
        bold,
        size,
      }),
    );
  }

  return runs.length > 0 ? runs : [new TextRun({ text: '', font, bold, size })];
}

/**
 * Builds standard GOST 2.104-2006 stamp tables with pixel-perfect TWIP dimensions (dxa).
 * Printable width: 185mm = 10488 dxa (A4 210mm - 20mm left - 5mm right).
 */
export function buildGost2104Form2Table(
  meta: Gost34DocMetadata,
  profile: StandardProfile = DEFAULT_GOST34_PROFILE,
  indentMm = 0,
): Table {
  const sigs = meta.signatures;

  const font = 'Times New Roman';
  const smallTextSize = 14; // 7pt
  const normTextSize = 16; // 8pt
  const titleTextSize = 20; // 10pt bold

  const borderStyle = {
    style: BorderStyle.SINGLE,
    size: 8, // 1pt solid line
    color: '000000',
  };

  const borderOptions = {
    top: borderStyle,
    bottom: borderStyle,
    left: borderStyle,
    right: borderStyle,
  };

  const makeCell = (
    text: string,
    widthMm: number,
    opts: {
      bold?: boolean;
      size?: number;
      align?: DocxAlignment;
      colSpan?: number;
      pageField?: 'current' | 'total';
    } = {},
  ) => {
    const widthDxa = convertMillimetersToTwip(widthMm);
    return new TableCell({
      width: { size: widthDxa, type: WidthType.DXA },
      borders: borderOptions,
      columnSpan: opts.colSpan,
      margins: {
        top: convertMillimetersToTwip(0.5),
        bottom: convertMillimetersToTwip(0.5),
        left: convertMillimetersToTwip(1),
        right: convertMillimetersToTwip(1),
      },
      children: [
        new Paragraph({
          alignment: opts.align || AlignmentType.CENTER,
          spacing: { before: 0, after: 0, line: 200 },
          children: buildCellRuns(text, {
            font,
            bold: opts.bold ?? false,
            size: opts.size || normTextSize,
            pageField: opts.pageField,
          }),
        }),
      ],
    });
  };

  // Form 2 Table (185mm total width)
  return new Table({
    width: { size: convertMillimetersToTwip(FRAME_WIDTH_MM), type: WidthType.DXA },
    indent: { size: convertMillimetersToTwip(indentMm), type: WidthType.DXA },
    borders: borderOptions,
    rows: [
      // Row 1: Header title block
      new TableRow({
        height: { value: convertMillimetersToTwip(7), rule: 'exact' as any },
        children: [
          makeCell('Изм.', 7, { size: smallTextSize }),
          makeCell('Лист', 10, { size: smallTextSize }),
          makeCell('№ докум.', 23, { size: smallTextSize }),
          makeCell('Подп.', 15, { size: smallTextSize }),
          makeCell('Дата', 10, { size: smallTextSize }),
          makeCell(meta.documentCode, 70, { bold: true, size: titleTextSize }),
          makeCell('Стад.', 15, { size: smallTextSize }),
          makeCell('Лист', 17.5, { size: smallTextSize }),
          makeCell('Листов', 17.5, { size: smallTextSize }),
        ],
      }),
      // Row 2: Developer signature
      new TableRow({
        height: { value: convertMillimetersToTwip(5), rule: 'exact' as any },
        children: [
          makeCell('Разраб.', 17, {
            align: AlignmentType.LEFT,
            size: smallTextSize,
            colSpan: 2,
          }),
          makeCell(sigs.developer || '—', 23, {
            align: AlignmentType.LEFT,
            size: smallTextSize,
          }),
          makeCell('', 15),
          makeCell('', 10),
          makeCell(meta.fullSystemName.toUpperCase(), 70, {
            bold: true,
            size: normTextSize,
          }),
          makeCell('Р', 15, { bold: true }),
          makeCell('', 17.5, { pageField: 'current' }),
          makeCell('', 17.5, { pageField: 'total' }),
        ],
      }),
      // Row 3: Checker signature
      new TableRow({
        height: { value: convertMillimetersToTwip(5), rule: 'exact' as any },
        children: [
          makeCell('Пров.', 17, {
            align: AlignmentType.LEFT,
            size: smallTextSize,
            colSpan: 2,
          }),
          makeCell(sigs.checker || '—', 23, {
            align: AlignmentType.LEFT,
            size: smallTextSize,
          }),
          makeCell('', 15),
          makeCell('', 10),
          makeCell(meta.systemName, 70, { size: normTextSize }),
          makeCell(meta.developerName, 50, {
            bold: true,
            size: smallTextSize,
            colSpan: 3,
          }),
        ],
      }),
      // Row 4: Norm control & City
      new TableRow({
        height: { value: convertMillimetersToTwip(5), rule: 'exact' as any },
        children: [
          makeCell('Н.контр.', 17, {
            align: AlignmentType.LEFT,
            size: smallTextSize,
            colSpan: 2,
          }),
          makeCell(sigs.normControl || '—', 23, {
            align: AlignmentType.LEFT,
            size: smallTextSize,
          }),
          makeCell('', 15),
          makeCell('', 10),
          makeCell(meta.contractNumber || profile.citations.frameFallbackTitle, 70, {
            size: smallTextSize,
          }),
          makeCell(meta.city, 50, { size: smallTextSize, colSpan: 3 }),
        ],
      }),
      // Row 5: Approver
      new TableRow({
        height: { value: convertMillimetersToTwip(5), rule: 'exact' as any },
        children: [
          makeCell('Утв.', 17, {
            align: AlignmentType.LEFT,
            size: smallTextSize,
            colSpan: 2,
          }),
          makeCell(sigs.approver || '—', 23, {
            align: AlignmentType.LEFT,
            size: smallTextSize,
          }),
          makeCell('', 15),
          makeCell('', 10),
          makeCell(`Заказчик: ${meta.customerName}`, 120, {
            align: AlignmentType.LEFT,
            size: smallTextSize,
            colSpan: 4,
          }),
        ],
      }),
    ],
  });
}

/**
 * Builds Form 2a small footer stamp table for subsequent sheets (ГОСТ 2.104 - Форма 2а)
 * Total width: 185mm = 10488 dxa.
 */
export function buildGost2104Form2aTable(meta: Gost34DocMetadata, indentMm = 0): Table {
  const font = 'Times New Roman';
  const smallTextSize = 14;
  const normTextSize = 16;

  const borderStyle = {
    style: BorderStyle.SINGLE,
    size: 8,
    color: '000000',
  };

  const borderOptions = {
    top: borderStyle,
    bottom: borderStyle,
    left: borderStyle,
    right: borderStyle,
  };

  const makeCell = (
    text: string,
    widthMm: number,
    opts: {
      bold?: boolean;
      size?: number;
      align?: DocxAlignment;
      pageField?: 'current' | 'total';
    } = {},
  ) => {
    const widthDxa = convertMillimetersToTwip(widthMm);
    return new TableCell({
      width: { size: widthDxa, type: WidthType.DXA },
      borders: borderOptions,
      margins: {
        top: convertMillimetersToTwip(0.5),
        bottom: convertMillimetersToTwip(0.5),
        left: convertMillimetersToTwip(1),
        right: convertMillimetersToTwip(1),
      },
      children: [
        new Paragraph({
          alignment: opts.align || AlignmentType.CENTER,
          spacing: { before: 0, after: 0, line: 200 },
          children: buildCellRuns(text, {
            font,
            bold: opts.bold ?? false,
            size: opts.size || normTextSize,
            pageField: opts.pageField,
          }),
        }),
      ],
    });
  };

  return new Table({
    width: { size: convertMillimetersToTwip(FRAME_WIDTH_MM), type: WidthType.DXA },
    indent: { size: convertMillimetersToTwip(indentMm), type: WidthType.DXA },
    borders: borderOptions,
    rows: [
      new TableRow({
        height: { value: convertMillimetersToTwip(12), rule: 'exact' as any },
        children: [
          makeCell('Изм.', 7, { size: smallTextSize }),
          makeCell('Лист', 10, { size: smallTextSize }),
          makeCell('№ докум.', 23, { size: smallTextSize }),
          makeCell('Подп.', 15, { size: smallTextSize }),
          makeCell('Дата', 10, { size: smallTextSize }),
          makeCell(meta.documentCode, 110, { bold: true, size: normTextSize }),
          makeCell('Лист ', 10, { size: smallTextSize, pageField: 'current' }),
        ],
      }),
    ],
  });
}
