import { describe, it, expect } from 'vitest';
import { analyzeAndNormalizeInput } from '../analyzer';
import { buildGost34DocumentAST } from '../generator';
import { exportGost34ToDocx } from '../exporters/docxExporter';
import { GostDocumentType } from '../types';

const sampleCalc = {
  id: 'calc-advanced-test',
  name: 'Корпоративный портал EvaCal Enterprise',
  customer: 'ПАО ГазТехИнвест',
  pmHours: 40,
  stages: [
    {
      id: 's1',
      order: 1,
      name: 'Предпроектное обследование и ТЗ',
      role: 'аналитик',
      hours: 56,
      requirements: 'Сбор требований и формализация по ГОСТ 34.',
    },
    {
      id: 's2',
      order: 2,
      name: 'Проектирование СУБД и Архитектуры',
      role: 'архитектор',
      hours: 80,
      requirements: 'Проектирование схемы PostgreSQL и REST API.',
    },
    {
      id: 's3',
      order: 3,
      name: 'Разработка подсистемы защиты информации (ИБ)',
      role: 'инженер',
      hours: 96,
      requirements: 'Выполнение Приказов ФСТЭК № 21 и № 117.',
    },
  ],
  risks: [
    {
      id: 'r1',
      description: 'Задержка поставки аппаратного сервера',
      hours: 20,
    },
  ],
};

const DOC_TYPES: GostDocumentType[] = ['TZ', 'PZ', 'AF', 'PMI', 'SPEC'];

// PK\x03\x04 — local file header magic; a .docx is a zip container.
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

describe('GOST 34 document generation', () => {
  it.each(DOC_TYPES)('generates a non-empty .docx for %s', async (docType) => {
    const payload = analyzeAndNormalizeInput({
      calculation: sampleCalc,
      metadataOverride: {
        docType,
        contractNumber: 'Договор № 100-ГС/2026',
        enrichRequirements: true,
      },
    });

    const ast = buildGost34DocumentAST(payload);
    expect(ast.sections.length).toBeGreaterThan(0);

    const docxBuffer = await exportGost34ToDocx(ast);
    expect(docxBuffer.length).toBeGreaterThan(0);
    expect(docxBuffer.subarray(0, 4)).toEqual(ZIP_MAGIC);
  });
});
