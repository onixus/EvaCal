import path from 'node:path';
import PDFDocument from 'pdfkit';
import { roleLabel, STATUS_LABELS } from './roles';
import { totalLaborHours } from './scheduling';
import { risksTotalHours } from './totals';
import { CalculationForExport as CalculationForPdf } from './export';
import { calculateCommercialSummary, formatCurrency } from './commercial';

// pdfkit's built-in fonts only support WinAnsi (no Cyrillic), so a Cyrillic-capable
// TTF is bundled via the dejavu-fonts-ttf package instead of relying on the host's fonts.
// The path is built from process.cwd() rather than require.resolve(), because webpack
// rewrites require.resolve() calls to an internal module id instead of a real filesystem
// path once this module is bundled into a Next.js route handler.
const FONTS_DIR = path.join(process.cwd(), 'node_modules', 'dejavu-fonts-ttf', 'ttf');
const FONT_REGULAR = path.join(FONTS_DIR, 'DejaVuSans.ttf');
const FONT_BOLD = path.join(FONTS_DIR, 'DejaVuSans-Bold.ttf');

function fmtDate(d: Date): string {
  return new Date(d).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

const COLS = {
  name: { x: 40, width: 175 },
  role: { x: 220, width: 65 },
  hours: { x: 290, width: 35 },
  start: { x: 330, width: 60 },
  end: { x: 395, width: 60 },
  status: { x: 460, width: 95 },
};

export function renderCalculationPdf(calc: CalculationForPdf): PDFKit.PDFDocument {
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
  doc.registerFont('body', FONT_REGULAR);
  doc.registerFont('bold', FONT_BOLD);
  doc.font('body');

  const pageBottom = doc.page.height - doc.page.margins.bottom;
  function ensureSpace(height: number) {
    if (doc.y + height > pageBottom) doc.addPage();
  }

  doc.font('bold').fontSize(18).fillColor('#000').text(calc.name);
  doc.font('body').fontSize(10).fillColor('#555');
  doc.text(
    `Заказчик: ${calc.customer}   Шаблон: ${calc.templateName}   Старт: ${fmtDate(
      calc.startDate,
    )}   Статус: ${STATUS_LABELS[calc.status] ?? calc.status}`,
  );
  doc.fillColor('#000');
  doc.moveDown(1.2);

  if (calc.fields.length > 0) {
    doc.font('bold').fontSize(13).text('Ответы опросника');
    doc.moveDown(0.3);
    doc.font('body').fontSize(10);
    for (const f of calc.fields) {
      const text = `${f.label}: ${String(calc.answers[f.key] ?? '—')}`;
      ensureSpace(doc.heightOfString(text, { width: 515 }) + 2);
      doc.text(text, 40, doc.y, { width: 515 });
    }
    doc.moveDown(1);
  }

  doc.font('bold').fontSize(13).text('Этапы', 40, doc.y);
  doc.moveDown(0.4);

  function drawRow(
    cells: {
      name: string;
      role: string;
      hours: string;
      start: string;
      end: string;
      status: string;
    },
    opts: { bold?: boolean; note?: string } = {},
  ) {
    const font = opts.bold ? 'bold' : 'body';
    doc.font(font).fontSize(9);
    const rowHeight =
      Math.max(
        doc.heightOfString(cells.name, { width: COLS.name.width }),
        doc.heightOfString(cells.role, { width: COLS.role.width }),
        doc.heightOfString(cells.status, { width: COLS.status.width }),
      ) + (opts.note ? doc.heightOfString(opts.note, { width: COLS.name.width }) + 2 : 0);

    ensureSpace(rowHeight + 4);
    const y = doc.y;

    doc.font(font).fontSize(9).fillColor('#000');
    doc.text(cells.name, COLS.name.x, y, { width: COLS.name.width });
    if (opts.note) {
      doc.font('body').fontSize(8).fillColor('#666');
      doc.text(opts.note, COLS.name.x, doc.y, { width: COLS.name.width });
      doc.fillColor('#000');
    }
    doc.font(font).fontSize(9);
    doc.text(cells.role, COLS.role.x, y, { width: COLS.role.width });
    doc.text(cells.hours, COLS.hours.x, y, { width: COLS.hours.width });
    doc.text(cells.start, COLS.start.x, y, { width: COLS.start.width });
    doc.text(cells.end, COLS.end.x, y, { width: COLS.end.width });
    doc.text(cells.status, COLS.status.x, y, { width: COLS.status.width });

    doc.y = y + rowHeight + 4;
  }

  drawRow(
    {
      name: 'Этап',
      role: 'Роль',
      hours: 'Ч',
      start: 'Начало',
      end: 'Окончание',
      status: 'Статус',
    },
    { bold: true },
  );
  doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#ccc').stroke();
  doc.moveDown(0.3);

  for (const stage of calc.stages) {
    drawRow(
      {
        name: `${stage.isApprovalTask ? '⏳ ' : ''}${stage.name}`,
        role: roleLabel(stage.role),
        hours: stage.isApprovalTask ? '—' : String(stage.hours),
        start: fmtDate(stage.startDate),
        end: fmtDate(stage.endDate),
        status: STATUS_LABELS[stage.status] ?? stage.status,
      },
      { note: stage.requirements ?? undefined },
    );
  }

  doc.moveDown(1);

  const stagesHours = totalLaborHours(calc.stages);
  const risksHours = risksTotalHours(calc.risks);
  const grandTotal = stagesHours + calc.pmHours + risksHours;

  const commercial = calculateCommercialSummary(calc.stages, calc.pmHours, calc.risks, {
    currency: calc.currency,
    roleRates: calc.roleRates,
    overheadPercent: calc.overheadPercent,
    marginPercent: calc.marginPercent,
    discountPercent: calc.discountPercent,
    vatPercent: calc.vatPercent,
    includeVat: calc.includeVat,
  });

  ensureSpace(140);
  doc.font('bold').fontSize(13).text('Трудозатраты и стоимость', 40, doc.y);
  doc.moveDown(0.3);
  doc.font('body').fontSize(10);
  doc.text(`Трудоемкость этапов: ${stagesHours} ч`, 40, doc.y);
  doc.text(`Управление проектом (РП): ${calc.pmHours} ч`, 40, doc.y);
  doc.text(`Резерв на риски: ${risksHours} ч`, 40, doc.y);
  doc
    .font('bold')
    .text(
      `Итого трудоемкость: ${grandTotal} ч (≈ ${(grandTotal / 8).toFixed(1)} раб. дн.)`,
      40,
      doc.y,
    );
  doc.moveDown(0.5);

  doc
    .font('body')
    .text(
      `Прямая себестоимость: ${formatCurrency(commercial.directLaborCost, commercial.currency)}`,
      40,
      doc.y,
    );
  if (commercial.overheadAmount > 0) {
    doc.text(
      `Накладные расходы (${commercial.overheadPercent}%): ${formatCurrency(commercial.overheadAmount, commercial.currency)}`,
      40,
      doc.y,
    );
  }
  doc.text(
    `Плановая маржа (${commercial.marginPercent}%): ${formatCurrency(commercial.marginAmount, commercial.currency)}`,
    40,
    doc.y,
  );
  if (commercial.discountAmount > 0) {
    doc.text(
      `Скидка (${commercial.discountPercent}%): -${formatCurrency(commercial.discountAmount, commercial.currency)}`,
      40,
      doc.y,
    );
  }
  doc.text(
    `Сумма без НДС: ${formatCurrency(commercial.subtotalExVat, commercial.currency)} (ставка: ${formatCurrency(commercial.blendedHourlyRate, commercial.currency)}/ч)`,
    40,
    doc.y,
  );
  if (calc.includeVat) {
    doc.text(
      `НДС (${commercial.vatPercent}%): ${formatCurrency(commercial.vatAmount, commercial.currency)}`,
      40,
      doc.y,
    );
  }
  doc
    .font('bold')
    .fontSize(11)
    .text(
      `ИТОГО К ОПЛАТЕ: ${formatCurrency(commercial.grandTotal, commercial.currency)}`,
      40,
      doc.y,
    );
  doc.moveDown(1);

  if (calc.risks.length > 0) {
    ensureSpace(30);
    doc.font('bold').fontSize(13).text('Риски', 40, doc.y);
    doc.moveDown(0.3);
    doc.font('body').fontSize(10);
    for (const risk of calc.risks) {
      const text = `${risk.description} — ${risk.hours} ч`;
      ensureSpace(doc.heightOfString(text, { width: 515 }) + 2);
      doc.text(text, 40, doc.y, { width: 515 });
    }
  }

  return doc;
}
