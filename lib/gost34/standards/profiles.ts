import { DocumentProfile, StandardProfile } from './types';

/**
 * Legacy document set. Every string here is copied verbatim from the code it
 * replaces (docxExporter title switch, the ZIP filename list, template
 * citations) — this profile must reproduce the pre-registry output exactly.
 */
const LEGACY_DOCUMENT_TYPES: DocumentProfile[] = [
  {
    id: 'legacy-89-tz',
    docType: 'TZ',
    title: 'ТЕХНИЧЕСКОЕ ЗАДАНИЕ',
    standardCitation: 'ГОСТ 34.602-89',
    shortLabel: 'ТЗ',
    uiDescription: 'Техническое задание на создание системы',
    filenameBase: 'Техническое_задание_ГОСТ_34.602-89',
    zipOrder: 1,
    sections: [],
  },
  {
    id: 'legacy-89-pz',
    docType: 'PZ',
    title: 'ПОЯСНИТЕЛЬНАЯ ЗАПИСКА',
    standardCitation: 'РД 50-34.698-90 п.2.1',
    shortLabel: 'ПЗ',
    uiDescription: 'Пояснительная записка к техническому проекту',
    filenameBase: 'Пояснительная_записка_РД_50-34.698-90',
    zipOrder: 2,
    sections: [],
  },
  {
    id: 'legacy-89-af',
    docType: 'AF',
    title: 'ОПИСАНИЕ АВТОМАТИЗИРУЕМЫХ ФУНКЦИЙ',
    standardCitation: 'РД 50-34.698-90 п.2.2',
    shortLabel: 'АФ',
    uiDescription: 'Описание автоматизируемых функций системы',
    filenameBase: 'Описание_функций_РД_50-34.698-90',
    zipOrder: 3,
    sections: [],
  },
  {
    id: 'legacy-89-pmi',
    docType: 'PMI',
    title: 'ПРОГРАММА И МЕТОДИКА ИСПЫТАНИЙ',
    standardCitation: 'РД 50-34.698-90 п.2.7',
    shortLabel: 'ПМИ',
    uiDescription: 'Программа и методика приемо-сдаточных испытаний',
    filenameBase: 'Программа_и_методика_испытаний_РД_50-34.698-90',
    zipOrder: 4,
    sections: [],
  },
  {
    id: 'legacy-89-spec',
    docType: 'SPEC',
    title: 'СПЕЦИФИКАЦИЯ ОБОРУДОВАНИЯ И ПО',
    standardCitation: 'ГОСТ 34.201-89 / РД 50-34.698-90 п.2.8',
    shortLabel: 'SPEC',
    uiDescription: 'Спецификация программных средств и оборудования',
    filenameBase: 'Спецификация_оборудования_и_ПО_ГОСТ_34.201-89',
    zipOrder: 5,
    sections: [],
  },
];

/**
 * Same documents under the current standard set. Titles are unchanged — only
 * the citations differ. Clause numbers under ГОСТ Р 59795-2021 are deliberately
 * omitted rather than guessed: РД 50-34.698-90 has no one-to-one successor
 * clause mapping.
 */
const CURRENT_DOCUMENT_TYPES: DocumentProfile[] = [
  {
    ...LEGACY_DOCUMENT_TYPES[0],
    id: 'gost34-2020-tz',
    standardCitation: 'ГОСТ 34.602-2020',
    filenameBase: 'Техническое_задание_ГОСТ_34.602-2020',
  },
  {
    ...LEGACY_DOCUMENT_TYPES[1],
    id: 'gost34-2020-pz',
    // TODO(PR-03): verify clause-level mapping once the 2020 TZ schema lands.
    standardCitation: 'ГОСТ Р 59795-2021',
    filenameBase: 'Пояснительная_записка_ГОСТ_Р_59795-2021',
  },
  {
    ...LEGACY_DOCUMENT_TYPES[2],
    id: 'gost34-2020-af',
    // TODO(PR-03): verify clause-level mapping once the 2020 TZ schema lands.
    standardCitation: 'ГОСТ Р 59795-2021',
    filenameBase: 'Описание_функций_ГОСТ_Р_59795-2021',
  },
  {
    ...LEGACY_DOCUMENT_TYPES[3],
    id: 'gost34-2020-pmi',
    standardCitation: 'ГОСТ Р 59792-2021',
    filenameBase: 'Программа_и_методика_испытаний_ГОСТ_Р_59792-2021',
  },
  {
    ...LEGACY_DOCUMENT_TYPES[4],
    id: 'gost34-2020-spec',
    standardCitation: 'ГОСТ 34.201-2020',
    filenameBase: 'Спецификация_оборудования_и_ПО_ГОСТ_34.201-2020',
  },
];

export const GOST34_2020_PROFILE: StandardProfile = {
  id: 'ru-gost34-current',
  name: 'Актуальный профиль ГОСТ 34',
  version: '2020',
  effectiveFrom: '2022-01-01',
  // Citations are current, but the TZ section structure is still the 1989 one.
  status: 'preview',
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
  documentTypes: CURRENT_DOCUMENT_TYPES,
  citations: {
    primary: 'ГОСТ 34.602-2020',
    documentsClassifier: 'ГОСТ 34.201-2020',
    projectDocumentation: 'ГОСТ Р 59795-2021',
    testing: 'ГОСТ Р 59792-2021',
    // TODO(PR-03): no verified clause-level successor to РД 50-34.698-90 п.2.8 yet.
    specificationBasis: 'ГОСТ 34.201-2020 и ГОСТ Р 59795-2021',
    referencesList:
      'ГОСТ 34.602-2020, ГОСТ 34.201-2020, ГОСТ Р 59793-2021, ГОСТ Р 59795-2021, ГОСТ Р 59792-2021, ГОСТ 7.32-2017, ГОСТ Р 56939-2016, Приказы ФСТЭК России № 21 и № 117, Федеральный закон 152-ФЗ.',
    frameFallbackTitle: 'Техническое задание по ГОСТ 34',
    documentationSetSentence:
      'Комплект документации включает: ТЗ (ГОСТ 34.602-2020), ПЗ, АФ, ПМИ, Спецификацию ПО и оборудования (SPEC) и Руководство пользователя.',
  },
};

export const GOST34_LEGACY_PROFILE: StandardProfile = {
  id: 'gost34-legacy-89',
  name: 'Legacy профиль ГОСТ 34.602-89',
  version: '1989',
  effectiveFrom: '1989-01-01',
  status: 'stable',
  primaryStandard: {
    id: 'gost-34.602-89',
    title: 'ГОСТ 34.602-89 Техническое задание на создание автоматизированной системы',
    version: '1989',
    role: 'technical-assignment',
  },
  documentStandards: [
    {
      id: 'gost-34.201-89',
      title: 'ГОСТ 34.201-89 Виды, комплектность и обозначение документов',
      version: '1989',
      role: 'documents',
    },
    {
      id: 'rd-50-34.698-90',
      title: 'РД 50-34.698-90 Требования к содержанию документов',
      version: '1990',
      role: 'project-documentation',
    },
  ],
  lifecycleStandards: [
    {
      id: 'gost-34.601-90',
      title: 'ГОСТ 34.601-90 Автоматизированные системы. Стадии создания',
      version: '1990',
      role: 'lifecycle',
    },
  ],
  testingStandards: [
    {
      id: 'rd-50-34.698-90-p27',
      title: 'РД 50-34.698-90 п.2.7 Программа и методика испытаний',
      version: '1990',
      role: 'testing',
    },
  ],
  documentTypes: LEGACY_DOCUMENT_TYPES,
  citations: {
    primary: 'ГОСТ 34.602-89',
    documentsClassifier: 'ГОСТ 34.201-89',
    projectDocumentation: 'РД 50-34.698-90',
    testing: 'РД 50-34.698-90 п.2.7',
    specificationBasis: 'ГОСТ 34.201-89 и РД 50-34.698-90 (п. 2.8)',
    referencesList:
      'ГОСТ 34.602-89, ГОСТ 34.201-89, РД 50-34.698-90, ГОСТ 7.32-2017, ГОСТ Р 56939-2016, Приказы ФСТЭК России № 21 и № 117, Федеральный закон 152-ФЗ.',
    frameFallbackTitle: 'Техническое задание по ГОСТ 34',
    documentationSetSentence:
      'Комплект документации включает: ТЗ (ГОСТ 34.602-89), ПЗ, АФ, ПМИ, Спецификацию ПО и оборудования (SPEC) и Руководство пользователя.',
  },
};

export const GOST34_PROFILES = [
  GOST34_2020_PROFILE,
  GOST34_LEGACY_PROFILE,
];
