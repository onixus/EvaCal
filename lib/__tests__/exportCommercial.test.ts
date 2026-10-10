import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { renderCalculationXlsx } from '@/lib/xlsx';
import { renderCalculationPdf } from '@/lib/pdf';
import { CalculationForExport } from '@/lib/export';

describe('Commercial Exports', () => {
  const mockCalc: CalculationForExport = {
    id: 'calc_test',
    name: 'Внедрение ERP',
    customer: 'ООО Технологии',
    templateName: 'Шаблон ERP',
    status: 'approved',
    startDate: new Date('2026-10-01'),
    pmHours: 16,
    answers: { users: 200 },
    fields: [{ label: 'Количество пользователей', key: 'users' }],
    stages: [
      {
        name: 'Проектирование',
        role: 'architect',
        hours: 40,
        isApprovalTask: false,
        parallel: false,
        approvalDays: 3,
        startDate: new Date('2026-10-01'),
        endDate: new Date('2026-10-10'),
        dueDate: null,
        status: 'done',
        requirements: null,
      },
      {
        name: 'Разработка функционала',
        role: 'developer',
        hours: 80,
        isApprovalTask: false,
        parallel: false,
        approvalDays: null,
        startDate: new Date('2026-10-11'),
        endDate: new Date('2026-10-25'),
        dueDate: null,
        status: 'planned',
        requirements: null,
      },
    ],
    risks: [
      {
        description: 'Сложность интеграции с API',
        hours: 20,
      },
    ],
    currency: 'RUB',
    roleRates: JSON.stringify({ architect: 6000, developer: 4000, pm: 5000 }),
    overheadPercent: 10,
    marginPercent: 25,
    discountPercent: 5,
    vatPercent: 20,
    includeVat: true,
  };

  it('renders XLSX with commercial estimate sheet and calculations', () => {
    const buffer = renderCalculationXlsx(mockCalc);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(100);

    const workbook = XLSX.read(buffer, { type: 'buffer' });
    expect(workbook.SheetNames).toContain('Смета КП');
    expect(workbook.SheetNames).toContain('Расчёт');
    expect(workbook.SheetNames).toContain('Этапы');
    expect(workbook.SheetNames).toContain('Матрица прослеживаемости');

    const estimateSheet = workbook.Sheets['Смета КП'];
    const sheetText = JSON.stringify(XLSX.utils.sheet_to_json(estimateSheet));
    expect(sheetText).toContain('КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ');
    expect(sheetText).toContain('Архитектор');
    expect(sheetText).toContain('Разработчик');
    expect(sheetText).toContain('ИТОГО К ОПЛАТЕ');

    const stagesSheet = workbook.Sheets['Этапы'];
    const stagesText = JSON.stringify(XLSX.utils.sheet_to_json(stagesSheet));
    expect(stagesText).toContain('Проектирование');
    expect(stagesText).toContain('Разработка функционала');

    const matrixSheet = workbook.Sheets['Матрица прослеживаемости'];
    const matrixText = JSON.stringify(XLSX.utils.sheet_to_json(matrixSheet));
    expect(matrixText).toContain('МАТРИЦА ПРОСЛЕЖИВАЕМОСТИ');
    expect(matrixText).toContain('ГОСТ 34');
    expect(matrixText).toContain('ПМИ-');
  });

  it('escapes formulas to prevent CSV/XLSX injection (CWE-1236)', () => {
    const maliciousCalc: CalculationForExport = {
      ...mockCalc,
      name: '=cmd|"/C calc"!A0',
      customer: '+1234567890',
      answers: { users: '=1+1' },
      stages: [
        {
          ...mockCalc.stages[0],
          name: '@malicious_stage',
          requirements: '-some_formula()',
        },
      ],
    };

    const buffer = renderCalculationXlsx(maliciousCalc);
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const overviewSheet = workbook.Sheets['Расчёт'];
    const overviewData = XLSX.utils.sheet_to_json<string[]>(overviewSheet, { header: 1 });

    // Ensure cell strings are prefixed with single quote
    const nameRow = overviewData.find((row) => row[0] === 'Название');
    expect(nameRow?.[1]).toBe('\'=cmd|"/C calc"!A0');

    const customerRow = overviewData.find((row) => row[0] === 'Заказчик');
    expect(customerRow?.[1]).toBe("'+1234567890");
  });

  it('renders PDF document without errors including commercial estimate', () => {
    const doc = renderCalculationPdf(mockCalc);
    expect(doc).toBeDefined();
  });

  it.each([
    ['markup', 120],
    ['target_margin', 125],
  ] as const)('exports the saved %s mode and matching final amounts', (pricingMode, amount) => {
    const calc = {
      ...mockCalc,
      pricingMode,
      stages: [{ ...mockCalc.stages[0], role: 'developer', hours: 1 }],
      pmHours: 0,
      risks: [],
      roleRates: '{"developer":100}',
      overheadPercent: 0,
      marginPercent: 20,
      discountPercent: 0,
      includeVat: false,
    };
    const workbook = XLSX.read(renderCalculationXlsx(calc), { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets['Смета КП'], { header: 1 });
    expect(rows.find((row) => row[0] === 'ИТОГО К ОПЛАТЕ')?.[2]).toBe(amount);
    expect(rows.find((row) => row[0] === 'Прибыль после скидки')?.[2]).toBe(amount - 100);
    expect(
      rows.some(
        (row) =>
          row[0] ===
          (pricingMode === 'markup' ? 'Наценка на себестоимость' : 'Целевая маржа от выручки'),
      ),
    ).toBe(true);
    expect(renderCalculationPdf(calc)).toBeDefined();
  });
});
