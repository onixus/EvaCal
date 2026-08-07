import { StandardProfile } from './types';

export const GOST34_2020_PROFILE: StandardProfile = {
  id: 'ru-gost34-current',
  name: 'Актуальный профиль ГОСТ 34',
  version: '2020',
  effectiveFrom: '2022-01-01',
  primaryStandard: {
    id: 'gost-34.602-2020',
    title: 'ГОСТ 34.602-2020 Техническое задание на создание автоматизированной системы',
    version: '2020',
    role: 'technical-assignment',
  },
  documentStandards: [
    {
      id: 'gost-34.201-2020',
      title: 'ГОСТ 34.201-2020 Виды, комплектность и обозначение документов',
      version: '2020',
      role: 'documents',
    },
    {
      id: 'gost-r-59795-2021',
      title: 'ГОСТ Р 59795-2021 Содержание проектной документации автоматизированных систем',
      version: '2021',
      role: 'project-documentation',
    },
  ],
  lifecycleStandards: [
    {
      id: 'gost-r-59793-2021',
      title: 'ГОСТ Р 59793-2021 Автоматизированные системы. Стадии создания',
      version: '2021',
      role: 'lifecycle',
    },
  ],
  testingStandards: [
    {
      id: 'gost-r-59792-2021',
      title: 'ГОСТ Р 59792-2021 Испытания автоматизированных систем',
      version: '2021',
      role: 'testing',
    },
  ],
  documentTypes: [],
};

export const GOST34_LEGACY_PROFILE: StandardProfile = {
  id: 'gost34-legacy-89',
  name: 'Legacy профиль ГОСТ 34.602-89',
  version: '1989',
  effectiveFrom: '1989-01-01',
  primaryStandard: {
    id: 'gost-34.602-89',
    title: 'ГОСТ 34.602-89 Техническое задание на создание автоматизированной системы',
    version: '1989',
    role: 'technical-assignment',
  },
  documentStandards: [],
  lifecycleStandards: [],
  testingStandards: [],
  documentTypes: [],
};

export const GOST34_PROFILES = [
  GOST34_2020_PROFILE,
  GOST34_LEGACY_PROFILE,
];
