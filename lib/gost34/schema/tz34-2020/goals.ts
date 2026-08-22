import { SchemaNode, SectionContent } from '../types';
import { TZ_2020_SECTIONS } from '../tz34-2020-sections';
import { gapsFor } from './utils';

export const sectionGoals: SchemaNode = {
  id: 'tz2020-goals',
  title: TZ_2020_SECTIONS.goals,
  required: true,
  children: [
    {
      id: 'tz2020-goals-goals',
      title: 'Цели создания АС',
      required: true,
      build: ({ context }): SectionContent => {
        const items = (context.goals || []).map((g) => g.statement);
        const criteria = context.measurableGoalCriteria || [];
        const tables =
          criteria.length > 0
            ? [
                {
                  caption: 'Измеримые критерии достижения целей создания системы',
                  headers: ['Цель', 'Показатель', 'Целевое значение', 'Способ измерения'],
                  rows: criteria.map((c) => [
                    c.goalId || '—',
                    c.metric,
                    c.target || '—',
                    c.measurementMethod || '—',
                  ]),
                },
              ]
            : undefined;

        return { items, tables, gaps: gapsFor(context, ['goals', 'measurableGoalCriteria']) };
      },
    },
    {
      id: 'tz2020-goals-purpose',
      title: 'Назначение АС',
      required: true,
      build: ({ context }): SectionContent => {
        const items: string[] = [];
        if (context.systemPurpose) items.push(`Назначение системы: ${context.systemPurpose}.`);
        if (context.automationObject)
          items.push(`Автоматизируемая деятельность: ${context.automationObject}.`);
        const users = context.users || [];
        if (users.length > 0) {
          items.push(
            `Пользователи системы: ${users
              .map(
                (u) =>
                  `${u.name}${u.approximateCount !== undefined ? ` (${u.approximateCount})` : ''}`,
              )
              .join('; ')}.`,
          );
        }
        return { items, gaps: gapsFor(context, ['systemPurpose', 'automationObject', 'users']) };
      },
    },
  ],
};
