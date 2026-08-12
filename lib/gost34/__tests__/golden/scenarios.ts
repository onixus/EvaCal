/**
 * Контрольные (golden) сценарии выпуска документов ГОСТ 34 — этап 12 плана
 * модернизации.
 *
 * Каждый сценарий описывает типовой проект: от простой внутренней системы до
 * объекта КИИ и изолированного контура. Слепок документа по каждому сценарию
 * лежит рядом в `*.json` и сравнивается тестом: любое изменение структуры
 * документа, состава требований или вывода движка применимости становится
 * видимым в диффе ревью, а не обнаруживается у Заказчика.
 */

import type { GostDocumentType } from '../../types';
import type { ProjectContext } from '../../context/types';
import { CURRENT_GOST34_PROFILE_ID, LEGACY_GOST34_PROFILE_ID } from '../../standards';

export interface GoldenCalculation {
  id: string;
  name: string;
  customer: string;
  pmHours?: number;
  stages?: Array<{
    id: string;
    order: number;
    name: string;
    role: string;
    hours: number;
    requirements?: string;
  }>;
  risks?: Array<{ id: string; description: string; hours: number }>;
}

export interface GoldenScenario {
  id: string;
  title: string;
  docType: GostDocumentType;
  standardProfileId: string;
  calculation: GoldenCalculation;
  projectContext?: Partial<ProjectContext>;
}

/** Этапы, встречающиеся почти в каждом проекте: обследование → разработка → испытания. */
function baseStages(prefix: string): GoldenCalculation['stages'] {
  return [
    {
      id: `${prefix}-s1`,
      order: 1,
      name: 'Предпроектное обследование',
      role: 'аналитик',
      hours: 48,
      requirements: 'Система должна вести единый реестр объектов учёта с историей изменений.',
    },
    {
      id: `${prefix}-s2`,
      order: 2,
      name: 'Разработка подсистем',
      role: 'разработчик',
      hours: 160,
      requirements: 'Система должна предоставлять веб-интерфейс оператора с ролевым доступом.',
    },
    {
      id: `${prefix}-s3`,
      order: 3,
      name: 'Приёмочные испытания',
      role: 'инженер',
      hours: 64,
      requirements: 'Система должна проходить приёмо-сдаточные испытания по программе и методике.',
    },
  ];
}

export const GOLDEN_SCENARIOS: GoldenScenario[] = [
  {
    id: 'generic-corporate-as',
    title: 'Типовая корпоративная АС',
    docType: 'TZ',
    standardProfileId: CURRENT_GOST34_PROFILE_ID,
    calculation: {
      id: 'golden-generic',
      name: 'Корпоративная система управления заявками',
      customer: 'ПАО «ТехноСервис»',
      pmHours: 40,
      stages: baseStages('generic'),
      risks: [{ id: 'generic-r1', description: 'Задержка согласования ТЗ', hours: 16 }],
    },
    projectContext: {
      automationObject: 'Процессы обработки заявок подразделений предприятия',
      systemPurpose: 'Сокращение сроков обработки внутренних заявок',
      architecture: {
        style: 'клиент-серверная',
        components: ['Веб-портал оператора', 'Сервер приложений', 'СУБД'],
      },
      infrastructure: { deploymentModel: 'on-premise', importSubstitution: false },
      security: { personalDataProcessed: false, kiiObject: false },
    },
  },
  {
    id: 'ispdn',
    title: 'ИСПДн: обработка персональных данных',
    docType: 'TZ',
    standardProfileId: CURRENT_GOST34_PROFILE_ID,
    calculation: {
      id: 'golden-ispdn',
      name: 'Информационная система персональных данных сотрудников',
      customer: 'АО «Кадровый центр»',
      pmHours: 32,
      stages: baseStages('ispdn'),
    },
    projectContext: {
      automationObject: 'Кадровый учёт и обработка персональных данных сотрудников',
      systemPurpose: 'Централизованная обработка персональных данных с защитой по ФСТЭК',
      architecture: { style: 'клиент-серверная', components: ['Личный кабинет сотрудника'] },
      security: {
        personalDataProcessed: true,
        kiiObject: false,
        securityClass: 'УЗ-2',
      },
      dataClasses: [{ name: 'Персональные данные сотрудников', sensitivity: 'ПДн' }],
      infrastructure: { deploymentModel: 'on-premise', importSubstitution: true },
    },
  },
  {
    id: 'kii',
    title: 'Значимый объект КИИ',
    docType: 'TZ',
    standardProfileId: CURRENT_GOST34_PROFILE_ID,
    calculation: {
      id: 'golden-kii',
      name: 'АСУ технологическим процессом энергообъекта',
      customer: 'АО «Энергосети»',
      pmHours: 80,
      stages: baseStages('kii'),
      risks: [{ id: 'kii-r1', description: 'Категорирование объекта КИИ не завершено', hours: 40 }],
    },
    projectContext: {
      automationObject: 'Технологические процессы объекта энергетики',
      systemPurpose: 'Управление технологическим процессом значимого объекта КИИ',
      architecture: { style: 'клиент-серверная', components: ['АРМ диспетчера', 'Сервер SCADA'] },
      security: {
        kiiObject: true,
        personalDataProcessed: false,
        securityClass: '1 категория значимости',
      },
      infrastructure: {
        deploymentModel: 'on-premise',
        importSubstitution: true,
        platforms: ['Astra Linux', 'Postgres Pro'],
      },
      availability: { availabilityTargetPercent: 99.95, rtoMinutes: 10, rpoMinutes: 5 },
    },
  },
  {
    id: 'bank',
    title: 'Кредитная организация (банк)',
    docType: 'TZ',
    standardProfileId: CURRENT_GOST34_PROFILE_ID,
    calculation: {
      id: 'golden-bank',
      name: 'Система дистанционного банковского обслуживания',
      customer: 'АО «Профильный банк»',
      pmHours: 64,
      stages: baseStages('bank'),
    },
    projectContext: {
      automationObject: 'Дистанционное банковское обслуживание клиентов кредитной организации',
      systemPurpose: 'Обработка платёжных распоряжений клиентов банка с антифрод-контролем',
      architecture: {
        style: 'микросервисная',
        components: ['Личный кабинет клиента', 'Сервис антифрода', 'Платёжный шлюз'],
      },
      security: {
        personalDataProcessed: true,
        kiiObject: true,
        authentication: ['многофакторная аутентификация', 'электронная подпись'],
      },
      dataClasses: [{ name: 'Данные клиентов банка', sensitivity: 'ПДн + банковская тайна' }],
      availability: { availabilityTargetPercent: 99.9, rtoMinutes: 15, rpoMinutes: 5 },
      infrastructure: { deploymentModel: 'on-premise', importSubstitution: true },
    },
  },
  {
    id: 'nfo',
    title: 'Некредитная финансовая организация (НФО)',
    docType: 'TZ',
    standardProfileId: CURRENT_GOST34_PROFILE_ID,
    calculation: {
      id: 'golden-nfo',
      name: 'Учётная система страховой компании',
      customer: 'СК «Надёжность»',
      pmHours: 48,
      stages: baseStages('nfo'),
    },
    projectContext: {
      automationObject: 'Учёт договоров страхования некредитной финансовой организации',
      systemPurpose: 'Ведение договоров и выплат страховой компании (НФО)',
      architecture: { style: 'клиент-серверная', components: ['Портал агента'] },
      security: { personalDataProcessed: true, kiiObject: false },
      dataClasses: [{ name: 'Данные страхователей', sensitivity: 'ПДн' }],
      availability: { availabilityTargetPercent: 99.5, rtoMinutes: 60 },
      infrastructure: { deploymentModel: 'hybrid', importSubstitution: true },
    },
  },
  {
    id: 'air-gapped-as',
    title: 'АС изолированного контура',
    docType: 'TZ',
    standardProfileId: CURRENT_GOST34_PROFILE_ID,
    calculation: {
      id: 'golden-air-gapped',
      name: 'Автоматизированная система изолированного сегмента',
      customer: 'ФГУП «Спецпроект»',
      pmHours: 56,
      stages: baseStages('airgap'),
    },
    projectContext: {
      automationObject: 'Обработка сведений в физически изолированном сегменте сети',
      systemPurpose: 'Работа системы без подключения к сетям общего пользования',
      architecture: {
        style: 'клиент-серверная',
        components: ['АРМ оператора'],
        notes: ['Передача данных между контурами — только через однонаправленный шлюз'],
      },
      integrations: [],
      infrastructure: {
        deploymentModel: 'on-premise',
        importSubstitution: true,
        network: 'Изолированный сегмент без выхода в сети общего пользования',
        platforms: ['Astra Linux Special Edition'],
      },
      security: { personalDataProcessed: false, kiiObject: true },
      availability: { availabilityTargetPercent: 99.0, rtoMinutes: 120 },
    },
  },
  {
    id: 'high-availability-as',
    title: 'АС повышенной доступности',
    docType: 'TZ',
    standardProfileId: CURRENT_GOST34_PROFILE_ID,
    calculation: {
      id: 'golden-ha',
      name: 'Отказоустойчивая система обработки транзакций',
      customer: 'ООО «Ритейл Плюс»',
      pmHours: 72,
      stages: baseStages('ha'),
      risks: [{ id: 'ha-r1', description: 'Отсутствие резервной площадки', hours: 24 }],
    },
    projectContext: {
      automationObject: 'Обработка транзакций розничной сети в режиме 24×7',
      systemPurpose: 'Непрерывная обработка операций с резервированием площадок',
      architecture: {
        style: 'микросервисная',
        components: ['Балансировщик', 'Кластер приложений', 'Реплика СУБД'],
      },
      availability: {
        availabilityTargetPercent: 99.99,
        rtoMinutes: 5,
        rpoMinutes: 1,
        serviceWindow: 'круглосуточно, без плановых остановок',
      },
      performance: { concurrentUsers: 5000, peakRequestsPerSecond: 1200, maxResponseTimeMs: 500 },
      security: { personalDataProcessed: false, kiiObject: false },
      infrastructure: { deploymentModel: 'hybrid', importSubstitution: false },
    },
  },
  {
    id: 'simple-internal-system',
    title: 'Простая внутренняя система',
    docType: 'TZ',
    standardProfileId: CURRENT_GOST34_PROFILE_ID,
    calculation: {
      id: 'golden-simple',
      name: 'Внутренний справочник регламентов',
      customer: 'ООО «Малый Подрядчик»',
      pmHours: 8,
      stages: [
        {
          id: 'simple-s1',
          order: 1,
          name: 'Разработка',
          role: 'разработчик',
          hours: 40,
          requirements: 'Система должна хранить регламенты и обеспечивать поиск по ним.',
        },
      ],
    },
    projectContext: {
      automationObject: 'Хранение внутренних регламентов подразделения',
      systemPurpose: 'Быстрый поиск действующей редакции регламента',
      security: { personalDataProcessed: false, kiiObject: false },
      infrastructure: { deploymentModel: 'on-premise', importSubstitution: false },
    },
  },
  {
    id: 'legacy-gost34-602-89',
    title: 'Проект прежней редакции ГОСТ 34.602-89',
    docType: 'TZ',
    standardProfileId: LEGACY_GOST34_PROFILE_ID,
    calculation: {
      id: 'golden-legacy',
      name: 'Автоматизированная система документооборота',
      customer: 'ГУП «Архив»',
      pmHours: 24,
      stages: baseStages('legacy'),
      risks: [{ id: 'legacy-r1', description: 'Миграция данных прежней системы', hours: 32 }],
    },
    projectContext: {
      automationObject: 'Документооборот организации',
      systemPurpose: 'Учёт и хранение документов',
      security: { personalDataProcessed: false, kiiObject: false },
    },
  },
];
