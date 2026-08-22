import { SchemaNode, SectionContent } from '../types';
import { SEVERITY_LABELS } from './utils';

export const appendixGaps: SchemaNode = {
  id: 'tz2020-appendix-gaps',
  title: 'СВЕДЕНИЯ, ТРЕБУЮЩИЕ УТОЧНЕНИЯ',
  appendix: true,
  includeWhen: ({ context }) => (context.gaps || []).length > 0,
  build: ({ context }): SectionContent => ({
    paragraphs: [
      'В настоящем приложении приведены сведения проектного контекста, не подтверждённые источниками на момент выпуска документа. До их уточнения соответствующие разделы ТЗ не считаются согласованными.',
    ],
    tables: [
      {
        caption: 'Перечень сведений, требующих уточнения',
        headers: ['Поле проектного контекста', 'Значимость', 'Источник данных'],
        rows: (context.gaps || []).map((g) => [
          g.label,
          SEVERITY_LABELS[g.severity],
          g.hint || '—',
        ]),
      },
    ],
  }),
};
