import { SchemaNode, SectionContent } from '../types';
import { TZ_2020_SECTIONS } from '../tz34-2020-sections';
import { gapsFor, listOrGap } from './utils';

export const sectionPreparation: SchemaNode = {
  id: 'tz2020-preparation',
  title: TZ_2020_SECTIONS.preparation,
  required: true,
  build: ({ context }): SectionContent => {
    const items: string[] = [];
    if (context.infrastructure?.computeResources) {
      items.push(
        `Заказчик обеспечивает вычислительные ресурсы: ${context.infrastructure.computeResources}.`,
      );
    }
    items.push(
      ...listOrGap(
        context.infrastructure?.platforms,
        'Заказчик обеспечивает наличие программных платформ',
      ),
    );
    if ((context.users || []).length > 0) {
      items.push(
        `Заказчик обеспечивает выделение и обучение персонала по группам пользователей: ${(
          context.users || []
        )
          .map((u) => u.name)
          .join('; ')}.`,
      );
    }
    items.push(
      ...listOrGap(
        context.roles?.map((r) => r.name),
        'Заказчик назначает ответственных по ролям',
      ),
    );

    return { items, gaps: gapsFor(context, ['infrastructure', 'users', 'roles']) };
  },
};
