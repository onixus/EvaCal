import { SchemaNode, SectionContent } from '../types';
import { TZ_2020_SECTIONS } from '../tz34-2020-sections';
import { cite, gapsFor } from './utils';

export const sectionDevelopmentOrder: SchemaNode = {
  id: 'tz2020-development-order',
  title: TZ_2020_SECTIONS.developmentOrder,
  required: true,
  build: (c): SectionContent => {
    const { context } = c;
    const items = [
      `Стадии и этапы создания системы определяются в соответствии с ${cite(c, 'lifecycle')}.`,
    ];
    const stages = context.lifecycle?.stages || [];
    if (stages.length > 0) {
      items.push(`Последовательность этапов работ: ${stages.join(' → ')}.`);
    }
    if (context.lifecycle?.totalLaborHours !== undefined) {
      items.push(`Суммарная плановая трудоёмкость работ: ${context.lifecycle.totalLaborHours} ч.`);
    }
    items.push(
      'Изменения настоящего ТЗ вносятся дополнением, подписываемым Заказчиком и Разработчиком.',
    );
    return { items, gaps: gapsFor(context, ['lifecycle']) };
  },
};
