import { SchemaNode, SectionContent } from '../types';
import { TZ_2020_SECTIONS } from '../tz34-2020-sections';
import { cite, gapsFor } from './utils';

export const sectionDocumentation: SchemaNode = {
  id: 'tz2020-documentation',
  title: TZ_2020_SECTIONS.documentation,
  required: true,
  build: (c): SectionContent => {
    const { context } = c;
    const docs = context.documentationRequirements || [];
    const items = [
      `Виды, комплектность и обозначение документов определяются в соответствии с ${cite(c, 'documentsClassifier')}.`,
    ];

    const tables =
      docs.length > 0
        ? [
            {
              caption: 'Комплект документации, разрабатываемой по проекту',
              headers: ['Обозначение', 'Наименование документа', 'Нормативное основание'],
              rows: docs.map((d) => [
                d.code,
                d.name,
                d.standardReference || cite(c, 'documentsClassifier'),
              ]),
            },
          ]
        : undefined;

    if (docs.length === 0) {
      items.push(
        'Состав комплекта документации согласовывается Заказчиком и Разработчиком до начала стадии технического проектирования.',
      );
    }

    return { items, tables, gaps: gapsFor(context, ['documentationRequirements']) };
  },
};
