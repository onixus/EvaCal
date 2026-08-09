import * as XLSX from 'xlsx';
import { CalculationForExport } from './export';
import { roleLabel, STATUS_LABELS } from './roles';
import { totalLaborHours } from './scheduling';
import { risksTotalHours } from './totals';

function fmtDate(d: Date | null): string {
  if (!d) return '';
  return new Date(d).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function renderCalculationXlsx(calc: CalculationForExport): Buffer {
  const stagesHours = totalLaborHours(calc.stages);
  const risksHours = risksTotalHours(calc.risks);
  const grandTotal = stagesHours + calc.pmHours + risksHours;

  const wb = XLSX.utils.book_new();

  const overviewSheet = XLSX.utils.aoa_to_sheet([
    ['Название', calc.name],
    ['Заказчик', calc.customer],
    ['Шаблон', calc.templateName],
    ['Статус', STATUS_LABELS[calc.status] ?? calc.status],
    ['Дата старта', fmtDate(calc.startDate)],
    [],
    ['Трудозатраты, этапы, ч', stagesHours],
    ['Трудозатраты, РП, ч', calc.pmHours],
    ['Трудозатраты, риски, ч', risksHours],
    ['Трудозатраты, итого, ч', grandTotal],
  ]);
  overviewSheet['!cols'] = [{ wch: 24 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, overviewSheet, 'Расчёт');

  if (calc.fields.length > 0) {
    const answersSheet = XLSX.utils.aoa_to_sheet([
      ['Вопрос', 'Ответ'],
      ...calc.fields.map((f) => [f.label, String(calc.answers[f.key] ?? '')]),
    ]);
    answersSheet['!cols'] = [{ wch: 32 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, answersSheet, 'Ответы');
  }

  const stagesSheet = XLSX.utils.aoa_to_sheet([
    [
      'Этап',
      'Роль',
      'Параллельно',
      'Часы',
      'Начало',
      'Окончание',
      'Срок согласования',
      'Статус',
      'Требования',
    ],
    ...calc.stages.map((s) => [
      s.name,
      roleLabel(s.role),
      s.parallel ? 'Да' : '',
      s.isApprovalTask ? '' : s.hours,
      fmtDate(s.startDate),
      fmtDate(s.endDate),
      fmtDate(s.dueDate),
      STATUS_LABELS[s.status] ?? s.status,
      s.requirements ?? '',
    ]),
  ]);
  stagesSheet['!cols'] = [
    { wch: 34 },
    { wch: 14 },
    { wch: 12 },
    { wch: 8 },
    { wch: 12 },
    { wch: 12 },
    { wch: 18 },
    { wch: 14 },
    { wch: 40 },
  ];
  XLSX.utils.book_append_sheet(wb, stagesSheet, 'Этапы');

  if (calc.risks.length > 0) {
    const risksSheet = XLSX.utils.aoa_to_sheet([
      ['Описание', 'Часы'],
      ...calc.risks.map((r) => [r.description, r.hours]),
    ]);
    risksSheet['!cols'] = [{ wch: 70 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, risksSheet, 'Риски');
  }

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
