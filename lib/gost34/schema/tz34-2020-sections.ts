/**
 * Наименования обязательных разделов ТЗ по ГОСТ 34.602-2020.
 *
 * Отдельный модуль без импортов: его используют и схема документа
 * (`tz34-2020.ts`), и реестр нормативных профилей (`standards/profiles.ts`),
 * поэтому он не должен ни от чего зависеть.
 */

export const TZ_2020_SECTIONS = {
  general: 'ОБЩИЕ СВЕДЕНИЯ',
  goals: 'ЦЕЛИ И НАЗНАЧЕНИЕ СОЗДАНИЯ (РАЗВИТИЯ) АС',
  automationObject: 'ХАРАКТЕРИСТИКА ОБЪЕКТОВ АВТОМАТИЗАЦИИ',
  requirements: 'ТРЕБОВАНИЯ К АВТОМАТИЗИРОВАННОЙ СИСТЕМЕ',
  workScope: 'СОСТАВ И СОДЕРЖАНИЕ РАБОТ ПО СОЗДАНИЮ АС',
  developmentOrder: 'ПОРЯДОК РАЗРАБОТКИ АС',
  acceptance: 'ПОРЯДОК КОНТРОЛЯ И ПРИЁМКИ АС',
  preparation: 'ТРЕБОВАНИЯ К ПОДГОТОВКЕ ОБЪЕКТА АВТОМАТИЗАЦИИ К ВВОДУ АС В ДЕЙСТВИЕ',
  documentation: 'ТРЕБОВАНИЯ К ДОКУМЕНТИРОВАНИЮ',
  sources: 'ИСТОЧНИКИ РАЗРАБОТКИ',
} as const;

/** Обязательные разделы в порядке, установленном стандартом. */
export const TZ_2020_SECTION_TITLES: string[] = [
  TZ_2020_SECTIONS.general,
  TZ_2020_SECTIONS.goals,
  TZ_2020_SECTIONS.automationObject,
  TZ_2020_SECTIONS.requirements,
  TZ_2020_SECTIONS.workScope,
  TZ_2020_SECTIONS.developmentOrder,
  TZ_2020_SECTIONS.acceptance,
  TZ_2020_SECTIONS.preparation,
  TZ_2020_SECTIONS.documentation,
  TZ_2020_SECTIONS.sources,
];

/** Идентификатор профиля, которому принадлежит схема (см. standards/profiles.ts). */
export const TZ_2020_PROFILE_ID = 'ru-gost34-current';
