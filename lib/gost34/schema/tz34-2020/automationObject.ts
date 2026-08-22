import { SchemaNode, SectionContent } from '../types';
import { TZ_2020_SECTIONS } from '../tz34-2020-sections';
import { gapsFor, listOrGap } from './utils';

export const sectionAutomationObject: SchemaNode = {
  id: 'tz2020-object',
  title: TZ_2020_SECTIONS.automationObject,
  required: true,
  build: ({ context }): SectionContent => {
    const items: string[] = [];
    if (context.automationObject) items.push(`Объект автоматизации: ${context.automationObject}.`);
    items.push(
      ...listOrGap(
        context.dataClasses?.map((d) => d.name),
        'Классы обрабатываемых данных',
      ),
    );
    items.push(
      ...listOrGap(context.architecture?.externalSystems, 'Смежные системы объекта автоматизации'),
    );
    items.push(...(context.architecture?.notes || []));

    const users = context.users || [];
    const tables =
      users.length > 0
        ? [
            {
              caption: 'Группы пользователей объекта автоматизации',
              headers: ['Группа пользователей', 'Ориентировочная численность', 'Характеристика'],
              rows: users.map((u) => [u.name, u.approximateCount ?? '—', u.description || '—']),
            },
          ]
        : undefined;

    return { items, tables, gaps: gapsFor(context, ['automationObject', 'dataClasses']) };
  },
};
