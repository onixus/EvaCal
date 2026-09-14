import { Gost34InputPayload, Gost34Section } from '../types';
import { Gost34RequirementV2 } from '../requirements/v2';

export function buildPSI34Sections(payload: Gost34InputPayload): Gost34Section[] {
  const meta = payload.metadata;
  const citations = payload.standardProfile.citations;
  const reqs = payload.customRequirements || [];
  const reqsV2: Gost34RequirementV2[] =
    payload.requirementsV2 ||
    reqs.map((r) => ({
      id: r.id,
      code: r.code,
      category: r.category,
      type: 'functional',
      title: r.title,
      originalText: r.description,
      approval: { status: 'APPROVED' },
    }));

  return [
    {
      id: 'sec-1',
      numStr: '1',
      title: 'ОБЪЕКТ И ОБЩИЕ ПОЛОЖЕНИЯ',
      paragraphs: [
        `1.1 Объект испытаний: Автоматизированная система «${meta.systemName}» (далее — Система).`,
        `1.2 Настоящий протокол фиксирует фактические результаты приемо-сдаточных испытаний (ПСИ) по стандарту ${citations.testing}.`,
        `1.3 Испытания проводились в соответствии с Программой и методикой испытаний (ПМИ).`,
      ],
    },
    {
      id: 'sec-2',
      numStr: '2',
      title: 'УСЛОВИЯ И ПОРЯДОК ПРОВЕДЕНИЯ ИСПЫТАНИЙ',
      paragraphs: [
        '2.1 Испытания проводились на тестовом и промышленном контурах Заказчика.',
        '2.2 Сбоев в работе аппаратного обеспечения во время проведения испытаний не зафиксировано.',
        '2.3 Исходные данные для испытаний были подготовлены в полном объеме.',
      ],
    },
    {
      id: 'sec-3',
      numStr: '3',
      title: 'РЕЗУЛЬТАТЫ ИСПЫТАНИЙ ПО ФУНКЦИОНАЛЬНЫМ И ТЕХНИЧЕСКИМ ТРЕБОВАНИЯМ',
      paragraphs: [
        '3.1 Фактические результаты выполнения тестовых сценариев приведены в Таблице 1.',
      ],
      tables: [
        {
          caption: 'Таблица 1 — Фактические результаты проверок',
          headers: [
            '№',
            'Код',
            'Проверяемое требование',
            'Критерий приемки',
            'Фактический результат',
            'Отметка',
          ],
          rows: reqsV2.map((r, idx) => {
            const criteria =
              r.acceptanceCriteria?.join('; ') || 'Успешное выполнение проверки без ошибок';
            // Фактический результат и отметку заполняет комиссия по итогам испытаний —
            // генератор не вправе проставлять «Соответствует» заранее.
            return [idx + 1, r.code, r.title, criteria, '', ''];
          }),
        },
      ],
    },
    {
      id: 'sec-4',
      numStr: '4',
      title: 'ВЫВОДЫ КОМИССИИ',
      paragraphs: [
        `4.1 Результат приемо-сдаточных испытаний системы «${meta.systemName}»: ____________________ (заполняется комиссией).`,
        '4.2 Решение комиссии: ____________________ (заполняется комиссией по итогам испытаний).',
      ],
    },
  ];
}
