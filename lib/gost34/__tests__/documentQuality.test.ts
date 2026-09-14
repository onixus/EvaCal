import { describe, expect, it } from 'vitest';
import { validateRequirements } from '../validation';
import { MODAL_PATTERN, NEGATION_PATTERN } from '../validation/lexicon';
import {
  fromGost34RequirementItem,
  fromGost34RequirementItems,
  toGost34RequirementItem,
} from '../requirements/adapters';
import { renderDocumentSchema } from '../schema/renderer';
import { buildProjectContext } from '../context/builder';
import { requirementCategoryLabel } from '../types';
import type { Gost34RequirementItem } from '../types';
import type { DocumentSchema, SchemaNode } from '../schema/types';
import type { ContextGap } from '../context/types';

const item = (over: Partial<Gost34RequirementItem> = {}): Gost34RequirementItem => ({
  id: 'r1',
  code: 'ТР-ПАК-01',
  category: 'hardware_pac',
  title: 'Серверная платформа',
  description: 'Комплекс должен быть построен на платформах из реестра Минпромторга России.',
  ...over,
});

describe('Обязывающая формулировка в мужском роде', () => {
  it('«должен» распознаётся наравне с «должна» и «должны»', () => {
    expect(MODAL_PATTERN.test('Комплекс должен быть построен на платформах.')).toBe(true);
    expect(MODAL_PATTERN.test('Сервер должен иметь два блока питания.')).toBe(true);
    expect(MODAL_PATTERN.test('Система должна обеспечивать обмен данными.')).toBe(true);
    expect(MODAL_PATTERN.test('Подсистемы должны быть резервированы.')).toBe(true);
  });

  it('описание без обязывающей формулировки по-прежнему не требование', () => {
    expect(MODAL_PATTERN.test('Комплекс построен на отечественных платформах.')).toBe(false);
  });

  it('отрицание «не должен» распознаётся', () => {
    expect(NEGATION_PATTERN.test('Сервер не должен превышать 2U по высоте.')).toBe(true);
    expect(NEGATION_PATTERN.test('Система не должна превышать 2 с по времени отклика.')).toBe(true);
  });

  it('требование с субъектом мужского рода не блокирует выпуск', () => {
    const result = validateRequirements(fromGost34RequirementItems([item()]));

    expect(result.counts.ERROR).toBe(0);
    expect(
      result.findings.filter((f) => f.rule === 'completeness' && f.severity === 'ERROR'),
    ).toHaveLength(0);
  });
});

describe('Критерий приёмки требования', () => {
  it('переносится в модель и обратно без потерь', () => {
    const criterion = 'Нагрузочное испытание на 150 сессий; проверка по ПМИ-ПР-01.';

    const v2 = fromGost34RequirementItem(item({ criterion }));
    expect(v2.acceptanceCriteria).toEqual([criterion]);

    expect(toGost34RequirementItem(v2).criterion).toBe(criterion);
  });

  it('без критерия поле не выдумывается', () => {
    const v2 = fromGost34RequirementItem(item());
    expect(v2.acceptanceCriteria).toBeUndefined();
    expect(toGost34RequirementItem(v2).criterion).toBeUndefined();
  });

  it('заданный критерий снимает предупреждение о непроверяемости', () => {
    const withCriterion = validateRequirements(
      fromGost34RequirementItems([
        item({ criterion: 'Проверка по ПМИ-ПАК-01: сверка реестровых номеров.' }),
      ]),
    );

    expect(
      withCriterion.findings.filter((f) => f.rule === 'testability' && f.severity === 'WARNING'),
    ).toHaveLength(0);
  });
});

describe('Русские наименования в таблицах документов', () => {
  it('категория требования печатается словами, а не ключом модели', () => {
    expect(requirementCategoryLabel('functional')).toBe('Функциональные');
    expect(requirementCategoryLabel('hardware_pac')).toBe('ПАК и оборудование');
    expect(requirementCategoryLabel('security')).toBe('Защита информации');
  });

  it('неизвестная категория возвращается как есть', () => {
    expect(requirementCategoryLabel('exotic')).toBe('exotic');
  });

  it('оценка сложности из опросника переводится на русский', () => {
    const ctx = buildProjectContext({
      systemName: 'АС',
      customerName: 'Заказчик',
      answers: { complexity: 'high' },
    });

    const notes = ctx.architecture?.notes || [];
    expect(notes.some((n) => n.includes('высокая'))).toBe(true);
    expect(notes.some((n) => n.includes('high'))).toBe(false);
  });
});

describe('Отметки о сведениях, требующих уточнения', () => {
  const gap: ContextGap = {
    path: 'roles',
    label: 'Ролевая модель системы',
    severity: 'major',
    hint: 'Опросник: перечень ролей',
  };

  const node = (id: string, title: string, gaps: ContextGap[]): SchemaNode => ({
    id,
    title,
    build: () => ({ gaps }),
  });

  const schema: DocumentSchema = {
    id: 'test-schema',
    profileId: 'test',
    nodes: [
      node('first', 'Первый раздел', [gap]),
      node('second', 'Второй раздел', [gap]),
      { id: 'registry', title: 'СВЕДЕНИЯ, ТРЕБУЮЩИЕ УТОЧНЕНИЯ', appendix: true, gapRegistry: true },
    ],
  };

  const render = () =>
    renderDocumentSchema(schema, {
      payload: {} as never,
      context: { gaps: [gap] },
      schema,
    });

  it('печатаются один раз, повтор заменяется ссылкой на приложение', () => {
    const { sections } = render();

    expect(sections[0].paragraphs).toEqual([
      'Ролевая модель системы — Требует уточнения у Заказчика (источник данных: Опросник: перечень ролей).',
    ]);
    expect(sections[1].paragraphs).toEqual([
      'Сведения, требующие уточнения и относящиеся к настоящему разделу: Ролевая модель системы — приведены в приложении А.',
    ]);
  });

  it('в перечень пробелов документа поле попадает одной записью', () => {
    expect(render().gaps).toHaveLength(1);
  });
});
