/**
 * Схема технического задания по ГОСТ 34.602-2020.
 *
 * Структура задаётся деревом узлов; содержимое каждого раздела строится
 * из ProjectContext и модели требований. Никаких сведений о конкретной
 * системе (стек, инфраструктура, SLA) в схеме нет, а обозначения
 * стандартов берутся из нормативного профиля (PR-01), а не пишутся здесь.
 */

import { DocumentSchema, SchemaNode } from './types';
import { TZ_2020_PROFILE_ID } from './tz34-2020-sections';

import { sectionGeneralInfo } from './tz34-2020/generalInfo';
import { sectionGoals } from './tz34-2020/goals';
import { sectionAutomationObject } from './tz34-2020/automationObject';
import { sectionRequirements } from './tz34-2020/requirements';
import { sectionWorkScope } from './tz34-2020/workScope';
import { sectionDevelopmentOrder } from './tz34-2020/developmentOrder';
import { sectionAcceptance } from './tz34-2020/acceptance';
import { sectionPreparation } from './tz34-2020/preparation';
import { sectionDocumentation } from './tz34-2020/documentation';
import { sectionSources } from './tz34-2020/sources';
import { appendixGaps } from './tz34-2020/appendixGaps';

const NODES: SchemaNode[] = [
  sectionGeneralInfo,
  sectionGoals,
  sectionAutomationObject,
  sectionRequirements,
  sectionWorkScope,
  sectionDevelopmentOrder,
  sectionAcceptance,
  sectionPreparation,
  sectionDocumentation,
  sectionSources,
  appendixGaps,
];

export const TZ_SCHEMA_2020: DocumentSchema = {
  id: 'tz-gost34-602-2020',
  profileId: TZ_2020_PROFILE_ID,
  nodes: NODES,
};

export { TZ_2020_SECTIONS, TZ_2020_SECTION_TITLES } from './tz34-2020-sections';
