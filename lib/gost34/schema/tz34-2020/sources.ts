import { SchemaNode, SectionContent } from '../types';
import { TZ_2020_SECTIONS } from '../tz34-2020-sections';

export const sectionSources: SchemaNode = {
  id: 'tz2020-sources',
  title: TZ_2020_SECTIONS.sources,
  required: true,
  build: ({ payload }): SectionContent => {
    const profile = payload.standardProfile;
    const items: string[] = [
      `${profile.primaryStandard.title}.`,
      ...[
        ...profile.documentStandards,
        ...profile.lifecycleStandards,
        ...profile.testingStandards,
      ].map((s) => `${s.title}.`),
    ];

    const vendorFiles = payload.vendorSourceFiles || [];
    if (vendorFiles.length > 0) {
      items.push(`Исходные документы Заказчика: ${vendorFiles.join('; ')}.`);
    }
    if (payload.templateName) {
      items.push(`Опросный лист проекта: «${payload.templateName}».`);
    }
    items.push(`Материалы обследования и расчёт трудозатрат проекта «${payload.systemName}».`);

    return { items };
  },
};
