import { describe, it, expect } from 'vitest';
import { analyzeAndNormalizeInput } from '../analyzer';
import { buildTZ34Document } from '../templates/tz34';
import { TZ_2020_SECTION_TITLES, TZ_SCHEMA_2020 } from '../schema/tz34-2020';
import { validateSchemaCoverage } from '../schema/renderer';
import { CURRENT_GOST34_PROFILE_ID, LEGACY_GOST34_PROFILE_ID, getDocumentProfile, resolveGost34Profile } from '../standards';
import { Gost34Section } from '../types';

const sampleCalc = {
  id: 'calc-tz-2020',
  name: 'АС управления техническим обслуживанием',
  customer: 'ПАО ГазТехИнвест',
  pmHours: 40,
  answers: JSON.stringify({
    объект_автоматизации: 'Процессы планирования и учёта технического обслуживания оборудования',
    назначение: 'Планирование, учёт и контроль работ по техническому обслуживанию',
    цели: 'Сокращение простоев оборудования; повышение прозрачности планирования',
    users_count: 400,
    platforms: 'Astra Linux; PostgreSQL 16',
    deployment: 'Локально в ЦОД Заказчика',
    availability_sla: '99.5',
    rto: '60',
    rpo: '15',
    персональные_данные: 'да',
  }),
  stages: [
    { id: 's1', order: 1, name: 'Обследование', role: 'аналитик', hours: 56, requirements: 'Обследование объекта автоматизации.' },
    { id: 's2', order: 2, name: 'Разработка', role: 'разработчик', hours: 120, requirements: 'Реализация функций планирования ТО.' },
  ],
  risks: [{ id: 'r1', description: 'Задержка предоставления доступа к смежным системам', hours: 20 }],
};

function currentProfilePayload(calculation: any = sampleCalc) {
  return analyzeAndNormalizeInput({
    calculation,
    metadataOverride: { standardProfileId: CURRENT_GOST34_PROFILE_ID },
  });
}

function flatten(sections: Gost34Section[]): Gost34Section[] {
  return sections.flatMap((s) => [s, ...flatten(s.subsections || [])]);
}

function allText(sections: Gost34Section[]): string {
  return flatten(sections)
    .map((s) => [s.title, ...s.paragraphs, ...(s.tables || []).flatMap((t) => t.rows.flat().map(String))].join('\n'))
    .join('\n');
}

describe('структура ТЗ по ГОСТ 34.602-2020', () => {
  const result = buildTZ34Document(currentProfilePayload());
  const body = result.sections.filter((s) => !s.numStr.startsWith('Приложение'));

  it('содержит обязательные разделы в порядке стандарта', () => {
    expect(body.map((s) => s.title)).toEqual([
      'ОБЩИЕ СВЕДЕНИЯ',
      'ЦЕЛИ И НАЗНАЧЕНИЕ СОЗДАНИЯ (РАЗВИТИЯ) АС',
      'ХАРАКТЕРИСТИКА ОБЪЕКТОВ АВТОМАТИЗАЦИИ',
      'ТРЕБОВАНИЯ К АВТОМАТИЗИРОВАННОЙ СИСТЕМЕ',
      'СОСТАВ И СОДЕРЖАНИЕ РАБОТ ПО СОЗДАНИЮ АС',
      'ПОРЯДОК РАЗРАБОТКИ АС',
      'ПОРЯДОК КОНТРОЛЯ И ПРИЁМКИ АС',
      'ТРЕБОВАНИЯ К ПОДГОТОВКЕ ОБЪЕКТА АВТОМАТИЗАЦИИ К ВВОДУ АС В ДЕЙСТВИЕ',
      'ТРЕБОВАНИЯ К ДОКУМЕНТИРОВАНИЮ',
      'ИСТОЧНИКИ РАЗРАБОТКИ',
    ]);
  });

  it('нумерует разделы и подразделы автоматически', () => {
    expect(body.map((s) => s.numStr)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
    expect((body[3].subsections || []).map((s) => s.numStr)).toEqual(['4.1', '4.2', '4.3', '4.4']);
  });

  it('проходит проверку соответствия схеме', () => {
    expect(validateSchemaCoverage(TZ_SCHEMA_2020, result.sections)).toEqual([]);
    expect(result.issues).toEqual([]);
  });

  it('является единственным источником состава разделов для реестра профилей', () => {
    const docProfile = getDocumentProfile(resolveGost34Profile(CURRENT_GOST34_PROFILE_ID), 'TZ');
    expect(docProfile.sections).toEqual(TZ_2020_SECTION_TITLES);
    expect(docProfile.sections).toEqual(body.map((s) => s.title));
  });
});

describe('содержимое ТЗ строится из проектного контекста', () => {
  const text = allText(buildTZ34Document(currentProfilePayload()).sections);

  it.each(['Next.js', 'Tailwind', 'Prisma', 'Docker', 'bcrypt', 'vCPU', 'GB RAM', 'EvaCal'])(
    'не содержит жёстко заданного «%s»',
    (forbidden) => {
      expect(text).not.toContain(forbidden);
    }
  );

  it('цитирует стандарты действующего профиля, а не legacy', () => {
    expect(text).not.toMatch(/34\.602-89|РД 50-34\.698-90/);
    expect(text).toContain('ГОСТ 34.602-2020');
    expect(text).toContain('ГОСТ Р 59793-2021');
  });

  it('переносит данные опросника в документ', () => {
    expect(text).toContain('Astra Linux');
    expect(text).toContain('99.5');
  });
});

describe('неподтверждённые сведения', () => {
  const result = buildTZ34Document(
    currentProfilePayload({ id: 'calc-empty', name: 'АС без опросника', customer: 'Заказчик', answers: '{}', stages: [] })
  );

  it('помечаются как требующие уточнения, а не выдумываются', () => {
    expect(result.gaps.length).toBeGreaterThan(0);
    expect(allText(result.sections)).toContain('Требует уточнения у Заказчика');
  });

  it('сводятся в приложение', () => {
    const appendix = result.sections.find((s) => s.numStr.startsWith('Приложение'));
    expect(appendix?.numStr).toBe('Приложение А');

    // Каждый пробел, помеченный в разделах, попадает в перечень приложения.
    const listed = (appendix?.tables?.[0]?.rows || []).map((row) => String(row[0]));
    for (const gap of result.gaps) expect(listed).toContain(gap.label);
  });
});

describe('legacy-профиль', () => {
  it('применяется только при явном выборе и воспроизводит прежний документ', () => {
    const payload = analyzeAndNormalizeInput({
      calculation: sampleCalc,
      metadataOverride: { standardProfileId: LEGACY_GOST34_PROFILE_ID },
    });
    const legacy = buildTZ34Document(payload);

    expect(legacy.sections.map((s) => s.numStr)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
    expect(allText(legacy.sections)).toContain('ГОСТ 34.602-89');
    expect(legacy.gaps).toEqual([]);
  });
});
