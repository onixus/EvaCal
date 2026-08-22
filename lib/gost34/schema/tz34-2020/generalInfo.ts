import { SchemaNode, SectionContent } from '../types';
import { TZ_2020_SECTIONS } from '../tz34-2020-sections';
import { gapsFor } from './utils';

export const sectionGeneralInfo: SchemaNode = {
  id: 'tz2020-general',
  title: TZ_2020_SECTIONS.general,
  required: true,
  build: ({ payload, context }): SectionContent => {
    const meta = payload.metadata;
    const items = [
      `Полное наименование системы: ${meta.fullSystemName}.`,
      `Краткое наименование системы: ${meta.systemName}.`,
      `Обозначение документа: ${meta.documentCode}.`,
      `Наименование организации Заказчика: ${meta.customerName}.`,
      `Наименование организации Разработчика: ${meta.developerName}.`,
    ];

    items.push(
      meta.contractNumber
        ? `Основание для проведения работ: ${meta.contractNumber}.`
        : 'Основание для проведения работ: договор между Заказчиком и Разработчиком (реквизиты уточняются при заключении).',
    );

    const start = context.lifecycle?.startDate;
    const end = context.lifecycle?.endDate;
    if (start || end) {
      items.push(
        `Плановые сроки выполнения работ: ${start ? `начало — ${start}` : 'начало уточняется'}, ${
          end ? `окончание — ${end}` : 'окончание уточняется'
        }.`,
      );
    }
    items.push(
      'Порядок оформления и предъявления Заказчику результатов работ определён разделом «Порядок контроля и приёмки АС» настоящего ТЗ.',
    );

    return { items, gaps: start || end ? [] : gapsFor(context, ['lifecycle']) };
  },
};
