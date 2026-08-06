import { analyzeAndNormalizeInput } from '../analyzer';
import { buildGost34DocumentAST } from '../generator';
import { exportGost34ToDocx } from '../exporters/docxExporter';
import { GostDocumentType } from '../types';

async function testAll5Gost34DocTypes() {
  console.log('Testing GOST 34 Document Generator Phase 2 Advanced Features...');

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

  const docTypes: GostDocumentType[] = ['TZ', 'PZ', 'AF', 'PMI', 'SPEC'];

  for (const docType of docTypes) {
    console.log(`\n--- Generating document for docType: ${docType} ---`);
    const payload = analyzeAndNormalizeInput({
      calculation: sampleCalc,
      metadataOverride: {
        docType,
        contractNumber: 'Договор № 100-ГС/2026',
        enrichRequirements: true,
      },
    });

    const ast = buildGost34DocumentAST(payload);
    console.assert(ast.sections.length > 0, `AST for ${docType} should have sections`);

    const docxBuffer = await exportGost34ToDocx(ast);
    console.assert(docxBuffer.length > 0, `DOCX buffer for ${docType} should not be empty`);
    console.log(`✓ ${docType} successfully generated (${docxBuffer.length} bytes, ${ast.sections.length} sections)`);
  }

  console.log('\n✓ ALL 5 GOST 34 Document Types (TZ, PZ, AF, PMI, SPEC) tested successfully!');
}

testAll5Gost34DocTypes().catch(console.error);
