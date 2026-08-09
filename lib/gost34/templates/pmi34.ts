import { Gost34InputPayload, Gost34Section } from '../types';
import { Gost34RequirementV2, getRequirementEffectiveText } from '../requirements/v2';

export function buildPMI34Sections(payload: Gost34InputPayload): Gost34Section[] {
  const meta = payload.metadata;
  const stages = payload.stages;
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
      title: 'ОБЪЕКТ И ОБЩИЕ ПОЛОЖЕНИЯ ИСПЫТАНИЙ',
      paragraphs: [
        `1.1 Объект испытаний: Автоматизированная система «${meta.systemName}».`,
        `1.2 Настоящий документ регулирует порядок проведения приемо-сдаточных испытаний (ПСИ) по стандарту ${citations.testing}.`,
        `1.3 Цель испытаний: Проверка соответствия системы требованиям ТЗ (${meta.documentCode}).`,
      ],
    },
    {
      id: 'sec-2',
      numStr: '2',
      title: 'ТРЕБОВАНИЯ К УСЛОВИЯМ И СРЕДСТВАМ ИСПЫТАНИЙ',
      paragraphs: [
        '2.1 Испытания проводятся на тестовом контуре Заказчика.',
        '2.2 Для проведения испытаний используются проверенные веб-браузеры и стандартизированные рабочие места.',
      ],
    },
    {
      id: 'sec-3',
      numStr: '3',
      title: 'ПРОГРАММА И МЕТОДИКА ПРОВЕРКИ ФУНКЦИОНАЛЬНЫХ ТРЕБОВАНИЙ',
      paragraphs: ['3.1 Перечень тестовых сценариев по требованиям приведен в Таблице 1.'],
      tables: [
        {
          caption: 'Таблица 1 — Набор тестовых проверок по требованиям ТЗ',
          headers: [
            '№',
            'Код',
            'Проверяемая функция / Требование',
            'Метод проверки',
            'Критерии приемки / Ожидаемый результат',
          ],
          rows: reqsV2.map((r, idx) => {
            const method = r.verificationMethod || 'TEST';
            const criteria =
              r.acceptanceCriteria?.join('; ') || 'Успешное выполнение проверки без ошибок';
            const text = getRequirementEffectiveText(r);
            return [
              idx + 1,
              r.code,
              r.title,
              `Метод: ${method}`,
              `${criteria} (Требование: ${text.substring(0, 50)}...)`,
            ];
          }),
        },
      ],
    },
    {
      id: 'sec-4',
      numStr: '4',
      title: 'ПРОГРАММА ПРОВЕРКИ ЭТАПОВ РАЗРАБОТКИ И ПРИЕМКИ',
      paragraphs: ['4.1 План проверок по этапам приведен в Таблице 2.'],
      tables: [
        {
          caption: 'Таблица 2 — Проверки по этапам работ',
          headers: [
            '№',
            'Наименование этапа',
            'Критерий успешности приемки этапа',
            'Ответственная роль',
          ],
          rows: stages.map((s) => [
            s.order,
            s.name,
            s.requirements
              ? `Выполнение требования: ${s.requirements}`
              : 'Сдача результатов этапа без замечаний',
            s.role,
          ]),
        },
      ],
    },
    {
      id: 'sec-5',
      numStr: '5',
      title: 'ОФОРМЛЕНИЕ РЕЗУЛЬТАТОВ ИСПЫТАНИЙ',
      paragraphs: [
        '5.1 Результаты ПСИ фиксируются в Протоколе испытаний.',
        '5.2 При отсутствии критических замечаний подписывается Акт сдачи-приемки выполненных работ.',
      ],
    },
  ];
}
