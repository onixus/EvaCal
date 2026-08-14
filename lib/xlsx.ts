import * as XLSX from 'xlsx';
import { CalculationForExport } from './export';
import { roleLabel, STATUS_LABELS } from './roles';
import { totalLaborHours } from './scheduling';
import { risksTotalHours } from './totals';
import { calculateCommercialSummary } from './commercial';
import { buildFullTraceabilityMatrix } from './gost34/traceability/matrix';
import type { Gost34RequirementItem, Gost34StageItem } from './gost34/types';

function fmtDate(d: Date | null): string {
  if (!d) return '';
  return new Date(d).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function renderCalculationXlsx(
  calc: CalculationForExport,
  options?: { customRequirements?: Gost34RequirementItem[] },
): Buffer {
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

  const wb = XLSX.utils.book_new();

  // 1. Overview Sheet
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
    [],
    ['Стоимость без НДС, ' + commercial.currencySymbol, commercial.subtotalExVat],
    ['НДС (' + commercial.vatPercent + '%), ' + commercial.currencySymbol, commercial.vatAmount],
    ['Итого к оплате, ' + commercial.currencySymbol, commercial.grandTotal],
  ]);
  overviewSheet['!cols'] = [{ wch: 28 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, overviewSheet, 'Расчёт');

  // 2. Commercial Proposal Sheet (Смета КП)
  const commercialRows: (string | number)[][] = [
    ['КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ И СМЕТА ЗАТРАТ'],
    ['Проект:', calc.name],
    ['Заказчик:', calc.customer],
    ['Валюта:', commercial.currency],
    [],
    ['1. ПРЯМЫЕ ТРУДОЗАТРАТЫ ПО РОЛЯМ'],
    ['Роль / Специализация', 'Трудоемкость (ч)', `Ставка (${commercial.currencySymbol}/ч)`, `Стоимость (${commercial.currencySymbol})`, 'Доля в трудозатратах'],
  ];

  for (const roleItem of commercial.rolesBreakdown) {
    commercialRows.push([
      roleItem.roleLabel,
      roleItem.hours,
      roleItem.rate,
      roleItem.cost,
      `${roleItem.sharePercent}%`,
    ]);
  }

  if (commercial.pmHours > 0) {
    commercialRows.push([
      'Управление проектом (РП)',
      commercial.pmHours,
      commercial.pmRate,
      commercial.pmCost,
      `${Math.round((commercial.pmCost / commercial.directLaborCost) * 100)}%`,
    ]);
  }

  if (commercial.riskHours > 0) {
    commercialRows.push([
      'Резерв на риски',
      commercial.riskHours,
      Math.round(commercial.riskCost / commercial.riskHours),
      commercial.riskCost,
      `${Math.round((commercial.riskCost / commercial.directLaborCost) * 100)}%`,
    ]);
  }

  commercialRows.push(
    ['Итого трудозатраты (прямая себестоимость):', commercial.directLaborHours, '', commercial.directLaborCost, '100%'],
    [],
    ['2. ФИНАНСОВЫЙ РАСЧЕТ И МАРЖИНАЛЬНОСТЬ'],
    ['Показатель', 'Параметр / %', `Сумма (${commercial.currencySymbol})`],
    ['Прямая себестоимость труда', '', commercial.directLaborCost],
    ['Накладные расходы (Overhead)', `${commercial.overheadPercent}%`, commercial.overheadAmount],
    ['Полная себестоимость проекта', '', commercial.totalCost],
    ['Плановая прибыль / Маржа', `${commercial.marginPercent}%`, commercial.marginAmount],
    ['Базовая цена до скидки', '', commercial.priceBeforeDiscount],
    ['Скидка', `${commercial.discountPercent}%`, -commercial.discountAmount],
    ['Итого без НДС', '', commercial.subtotalExVat],
    [`НДС (${commercial.vatPercent}%)`, calc.includeVat ? `${commercial.vatPercent}%` : '0% (не облагается)', commercial.vatAmount],
    ['ИТОГО К ОПЛАТЕ', '', commercial.grandTotal],
    [],
    ['Средневзвешенная ставка, ' + commercial.currencySymbol + '/ч', '', commercial.blendedHourlyRate],
  );

  const commercialSheet = XLSX.utils.aoa_to_sheet(commercialRows);
  commercialSheet['!cols'] = [{ wch: 36 }, { wch: 18 }, { wch: 18 }, { wch: 22 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, commercialSheet, 'Смета КП');

  // 3. Questionnaire Answers
  if (calc.fields.length > 0) {
    const answersSheet = XLSX.utils.aoa_to_sheet([
      ['Вопрос', 'Ответ'],
      ...calc.fields.map((f) => [f.label, String(calc.answers[f.key] ?? '')]),
    ]);
    answersSheet['!cols'] = [{ wch: 32 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, answersSheet, 'Ответы');
  }

  // 4. Stages Sheet
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

  // 5. Risks Sheet
  if (calc.risks.length > 0) {
    const risksSheet = XLSX.utils.aoa_to_sheet([
      ['Описание', 'Часы'],
      ...calc.risks.map((r) => [r.description, r.hours]),
    ]);
    risksSheet['!cols'] = [{ wch: 70 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, risksSheet, 'Риски');
  }

  // 6. Traceability Matrix Sheet (Матрица прослеживаемости требований ГОСТ 34)
  const stageItems: Gost34StageItem[] = calc.stages.map((s, idx) => ({
    id: `stage-${idx + 1}`,
    order: idx + 1,
    name: s.name,
    role: s.role,
    hours: s.hours,
    requirements: s.requirements || undefined,
  }));

  const reqsToTrace: Gost34RequirementItem[] = [];
  if (options?.customRequirements && options.customRequirements.length > 0) {
    reqsToTrace.push(...options.customRequirements);
  } else {
    // Derive requirements from stages and answers
    calc.stages.forEach((s, idx) => {
      if (s.requirements && s.requirements.trim().length > 0) {
        reqsToTrace.push({
          id: `req-stage-${idx + 1}`,
          code: `ТР-ЭТ-${String(idx + 1).padStart(2, '0')}`,
          category: /иб|безопасн|сзи|скзи|фстэк/i.test(s.name + ' ' + s.requirements)
            ? 'security'
            : /пак|сервер|схд|оборудован|монтаж/i.test(s.name + ' ' + s.requirements)
            ? 'hardware_pac'
            : /лиценз|поставк.*по/i.test(s.name + ' ' + s.requirements)
            ? 'software_supply'
            : /интеграц|api|шлюз/i.test(s.name + ' ' + s.requirements)
            ? 'integration'
            : 'functional',
          title: `Требование к этапу: ${s.name}`,
          description: s.requirements,
        });
      }
    });

    if (reqsToTrace.length === 0) {
      // Synthesize standard requirements from stages
      calc.stages.forEach((s, idx) => {
        reqsToTrace.push({
          id: `req-syn-${idx + 1}`,
          code: `ТР-${String(idx + 1).padStart(2, '0')}`,
          category: /иб|безопасн|сзи|скзи|фстэк/i.test(s.name)
            ? 'security'
            : /пак|сервер|схд|оборудован|монтаж/i.test(s.name)
            ? 'hardware_pac'
            : /лиценз|поставк.*по/i.test(s.name)
            ? 'software_supply'
            : /интеграц|api|шлюз/i.test(s.name)
            ? 'integration'
            : 'functional',
          title: s.name,
          description: `Выполнение работ и соответствие критериям приёмки этапа «${s.name}».`,
        });
      });
    }
  }

  const matrix = buildFullTraceabilityMatrix(
    reqsToTrace,
    stageItems,
    calc.answers,
    calc.fields,
  );

  if (matrix.items.length > 0) {
    const matrixRows: (string | number)[][] = [
      ['МАТРИЦА ПРОСЛЕЖИВАЕМОСТИ ТРЕБОВАНИЙ И СТАДИЙ ПРОЕКТА (ГОСТ 34.602)'],
      ['Проект:', calc.name],
      ['Заказчик:', calc.customer],
      ['Покрытие требований:', `${matrix.metrics.covered} из ${matrix.metrics.total} (${matrix.metrics.coveragePercent}%)`],
      [],
      [
        'Код требования',
        'Категория',
        'Наименование требования',
        'Содержание требования',
        'Раздел ГОСТ 34',
        'Наименование раздела ГОСТ 34',
        'Код методики ПМИ',
        'Программа и методика испытаний (ПМИ)',
        'Ожидаемый результат испытаний',
        'Этап реализации',
        'Роль исполнителя',
        'Метод сопоставления',
        'Статус покрытия',
      ],
    ];

    for (const item of matrix.items) {
      matrixRows.push([
        item.code,
        item.category,
        item.title,
        item.description,
        item.gostSection.code,
        item.gostSection.title,
        item.pmiTest.testCode,
        item.pmiTest.testTitle,
        item.pmiTest.expectedResult,
        item.stage?.name || 'Не назначен',
        item.stage?.roleLabel || '—',
        item.mappingMethod,
        item.status === 'covered' ? 'Покрыто' : 'Не покрыто',
      ]);
    }

    const matrixSheet = XLSX.utils.aoa_to_sheet(matrixRows);
    matrixSheet['!cols'] = [
      { wch: 14 },
      { wch: 16 },
      { wch: 28 },
      { wch: 45 },
      { wch: 14 },
      { wch: 34 },
      { wch: 16 },
      { wch: 40 },
      { wch: 40 },
      { wch: 28 },
      { wch: 20 },
      { wch: 16 },
      { wch: 16 },
    ];
    XLSX.utils.book_append_sheet(wb, matrixSheet, 'Матрица прослеживаемости');
  }

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
