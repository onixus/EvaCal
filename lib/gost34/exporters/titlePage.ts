import { AlignmentType, Paragraph, Table } from 'docx';
import type { Gost34DocMetadata } from '../types';
import type { DocxTypography } from './typography';

export function buildTitlePage(meta: Gost34DocMetadata, docTitleText: string, { run }: DocxTypography): (Paragraph | Table)[] {
  const sigs = meta.signatures;
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
      sigs.customerApprover || '________________',
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
      sigs.approver || '________________',
      0,
    ),

    // Город и год — внизу титульного листа, без тире между ними
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 3600, after: 0 },
      children: [run(`${meta.city} ${meta.year}`, { deltaPt: -2 })],
    }),
  ];

  return titlePageChildren;
}
