import { SchemaNode, SectionContent } from '../types';
import { TZ_2020_SECTIONS } from '../tz34-2020-sections';
import { cite } from './utils';

export const sectionAcceptance: SchemaNode = {
  id: 'tz2020-acceptance',
  title: TZ_2020_SECTIONS.acceptance,
  required: true,
  build: (c): SectionContent => {
    const { payload } = c;
    const items = [
      `Виды, состав и порядок проведения испытаний системы определяются в соответствии с ${cite(c, 'testing')}.`,
      'Приёмка системы осуществляется по результатам приёмочных испытаний, проводимых по согласованной программе и методике испытаний.',
      'Результаты приёмочных испытаний оформляются двусторонним актом.',
    ];

    const withCriteria = (payload.customRequirements || []).filter(
      (r) => r.description && r.description.trim().length > 0,
    );
    const tables =
      withCriteria.length > 0
        ? [
            {
              caption: 'Проверяемые требования и способ подтверждения соответствия',
              headers: ['Код требования', 'Наименование', 'Способ подтверждения'],
              rows: withCriteria.map((r) => [r.code, r.title, 'Приёмочные испытания']),
            },
          ]
        : undefined;

    return { items, tables };
  },
};
