import {
  Table,
  TableRow,
  TableCell,
  Paragraph,
  TextRun,
  AlignmentType,
  WidthType,
  BorderStyle,
  convertMillimetersToTwip,
} from 'docx';
import { Gost34DocMetadata } from '../types';

/**
 * Builds standard GOST 2.104-2006 stamp tables with pixel-perfect TWIP dimensions (dxa).
 * Printable width: 185mm = 10488 dxa (A4 210mm - 20mm left - 5mm right).
 */
export function buildGost2104Form2Table(meta: Gost34DocMetadata): Table {
  const sigs = meta.signatures;

  const font = 'Times New Roman';
  const smallTextSize = 14; // 7pt
  const normTextSize = 16;  // 8pt
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
    opts: { bold?: boolean; size?: number; align?: any; colSpan?: number } = {}
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
          children: [
            new TextRun({
              text,
              font,
              bold: opts.bold ?? false,
              size: opts.size || normTextSize,
            }),
          ],
        }),
      ],
    });
  };

  // Form 2 Table (185mm total width)
  return new Table({
    width: { size: convertMillimetersToTwip(185), type: WidthType.DXA },
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
          makeCell('Разраб.', 17, { align: AlignmentType.LEFT, size: smallTextSize, colSpan: 2 }),
          makeCell(sigs.developer || '—', 23, { align: AlignmentType.LEFT, size: smallTextSize }),
          makeCell('', 15),
          makeCell('', 10),
          makeCell(meta.fullSystemName.toUpperCase(), 70, { bold: true, size: normTextSize }),
          makeCell('Р', 15, { bold: true }),
          makeCell('1', 17.5),
          makeCell('X', 17.5),
        ],
      }),
      // Row 3: Checker signature
      new TableRow({
        height: { value: convertMillimetersToTwip(5), rule: 'exact' as any },
        children: [
          makeCell('Пров.', 17, { align: AlignmentType.LEFT, size: smallTextSize, colSpan: 2 }),
          makeCell(sigs.checker || '—', 23, { align: AlignmentType.LEFT, size: smallTextSize }),
          makeCell('', 15),
          makeCell('', 10),
          makeCell(meta.systemName, 70, { size: normTextSize }),
          makeCell(meta.developerName, 50, { bold: true, size: smallTextSize, colSpan: 3 }),
        ],
      }),
      // Row 4: Norm control & City
      new TableRow({
        height: { value: convertMillimetersToTwip(5), rule: 'exact' as any },
        children: [
          makeCell('Н.контр.', 17, { align: AlignmentType.LEFT, size: smallTextSize, colSpan: 2 }),
          makeCell(sigs.normControl || '—', 23, { align: AlignmentType.LEFT, size: smallTextSize }),
          makeCell('', 15),
          makeCell('', 10),
          makeCell(meta.contractNumber || 'Техническое задание по ГОСТ 34', 70, { size: smallTextSize }),
          makeCell(meta.city, 50, { size: smallTextSize, colSpan: 3 }),
        ],
      }),
      // Row 5: Approver
      new TableRow({
        height: { value: convertMillimetersToTwip(5), rule: 'exact' as any },
        children: [
          makeCell('Утв.', 17, { align: AlignmentType.LEFT, size: smallTextSize, colSpan: 2 }),
          makeCell(sigs.approver || '—', 23, { align: AlignmentType.LEFT, size: smallTextSize }),
          makeCell('', 15),
          makeCell('', 10),
          makeCell(`Заказчик: ${meta.customerName}`, 120, { align: AlignmentType.LEFT, size: smallTextSize, colSpan: 4 }),
        ],
      }),
    ],
  });
}

/**
 * Builds Form 2a small footer stamp table for subsequent sheets (ГОСТ 2.104 - Форма 2а)
 * Total width: 185mm = 10488 dxa.
 */
export function buildGost2104Form2aTable(meta: Gost34DocMetadata): Table {
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
    opts: { bold?: boolean; size?: number; align?: any } = {}
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
          children: [
            new TextRun({
              text,
              font,
              bold: opts.bold ?? false,
              size: opts.size || normTextSize,
            }),
          ],
        }),
      ],
    });
  };

  return new Table({
    width: { size: convertMillimetersToTwip(185), type: WidthType.DXA },
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
          makeCell('Лист', 10, { size: smallTextSize }),
        ],
      }),
    ],
  });
}
