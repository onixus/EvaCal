import { IndustryPreset } from '../types';

/**
 * Внедрение SIEM и построение мониторинга ИБ (SOC).
 *
 * Актуальные платформы РФ: MaxPatrol SIEM (Positive Technologies) и
 * Kaspersky Unified Monitoring and Analysis Platform (KUMA). Драйверы
 * спроса: 187-ФЗ (взаимодействие с ГосСОПКА по приказам ФСБ России
 * № 366/367/368), приказ ФСТЭК России № 239, ГОСТ Р 57580.1-2017 и
 * положения Банка России 683-П / 719-П для финансовых организаций.
 */
export const SIEM_MONITORING_PRESET: IndustryPreset = {
  id: 'preset-siem-soc',
  name: 'Внедрение SIEM и мониторинга ИБ (MaxPatrol SIEM / KUMA, ГосСОПКА)',
  category: 'monitoring',
  description:
    'Проект внедрения системы мониторинга событий информационной безопасности: развертывание SIEM-платформы (MaxPatrol SIEM / Kaspersky KUMA), подключение источников событий, разработка правил корреляции, регламентов реагирования и взаимодействия с ГосСОПКА (187-ФЗ, приказы ФСБ № 366-368).',
  workDayHours: 6,
  includeWeekends: false,
  defaultMarginPercent: 28,
  defaultRoleRates: {
    architect: 5000,
    engineer: 4000,
    analyst: 3600,
    consultant: 4400,
    developer: 3800,
    pm: 4200,
  },
  fields: [
    {
      label: 'Количество подключаемых источников событий (серверы, СЗИ, сетевое оборудование)',
      key: 'event_sources_count',
      type: 'number',
      required: true,
      order: 0,
    },
    {
      label: 'Ожидаемый поток событий (EPS, событий в секунду)',
      key: 'eps_estimate',
      type: 'number',
      required: true,
      order: 1,
    },
    {
      label: 'Количество нестандартных источников (разработка кастомных коннекторов/парсеров)',
      key: 'custom_connectors_count',
      type: 'number',
      required: true,
      order: 2,
    },
    {
      label: 'Требуется подключение к ГосСОПКА (субъект КИИ)',
      key: 'gossopka_required',
      type: 'checkbox',
      required: false,
      order: 3,
    },
    {
      label: 'Целевая SIEM-платформа',
      key: 'siem_platform',
      type: 'select',
      options: ['MaxPatrol SIEM', 'Kaspersky KUMA', 'RuSIEM', 'Определить по результатам пилота'],
      required: true,
      order: 4,
    },
    {
      label: 'Сложность инфраструктуры мониторинга',
      key: 'complexity',
      type: 'complexity',
      required: true,
      order: 5,
    },
    {
      label: 'Дополнительные требования (интеграция с IRP/SOAR, отраслевые стандарты ЦБ РФ)',
      key: 'comment',
      type: 'textarea',
      required: false,
      order: 6,
    },
  ],
  stageTemplates: [
    {
      name: 'Обследование и проектирование схемы сбора событий ИБ',
      role: 'architect',
      baseHours: 32,
      hoursPerUnit: 0.5,
      driverFieldKey: 'event_sources_count',
      requirements:
        'Инвентаризация источников событий, оценка EPS и требований к хранению, схема потоков логирования, сайзинг платформы SIEM по методике вендора, перечень сценариев выявления инцидентов (use cases).',
      order: 0,
    },
    {
      name: 'Развертывание платформы SIEM (ядро, коллекторы, хранилище)',
      role: 'engineer',
      baseHours: 40,
      hoursPerUnit: 0,
      driverFieldKey: null,
      requirements:
        'Установка компонентов SIEM по архитектуре вендора, настройка отказоустойчивости, ретенции и разграничения доступа операторов SOC.',
      order: 1,
    },
    {
      name: 'Подключение типовых источников событий',
      role: 'engineer',
      baseHours: 16,
      hoursPerUnit: 1.5,
      driverFieldKey: 'event_sources_count',
      requirements:
        'Настройка аудита на источниках (ОС, СУБД, СЗИ, сетевое оборудование), подключение штатными коннекторами, нормализация и категоризация событий, контроль полноты поступления.',
      order: 2,
    },
    {
      name: 'Разработка кастомных коннекторов и правил корреляции',
      role: 'developer',
      baseHours: 16,
      hoursPerUnit: 12,
      driverFieldKey: 'custom_connectors_count',
      requirements:
        'Разработка парсеров для нестандартных источников, адаптация и написание правил корреляции под сценарии выявления инцидентов, тюнинг ложных срабатываний.',
      order: 3,
    },
    {
      name: 'Регламенты реагирования и подключение к ГосСОПКА',
      role: 'consultant',
      baseHours: 28,
      hoursPerUnit: 0,
      driverFieldKey: null,
      requirements:
        'Разработка регламентов выявления и реагирования на инциденты, карточек инцидентов, порядка информирования НКЦКИ через техническую инфраструктуру ГосСОПКА (приказы ФСБ России № 366-368) — для субъектов КИИ.',
      order: 4,
    },
    {
      name: 'Опытная эксплуатация, обучение операторов SOC и ПМИ',
      role: 'analyst',
      baseHours: 24,
      hoursPerUnit: 0.3,
      driverFieldKey: 'event_sources_count',
      requirements:
        'Сопровождение опытной эксплуатации, верификация сценариев на тестовых атаках, обучение операторов и аналитиков, приёмочные испытания по ПМИ.',
      order: 5,
    },
  ],
  riskTemplates: [
    {
      description:
        'На части источников не включён или недостаточен аудит событий — потребуются доработки политик логирования Заказчиком.',
      hours: 16,
      order: 0,
    },
    {
      description:
        'Фактический поток событий (EPS) превышает оценку — потребуется пересмотр сайзинга и лицензий платформы.',
      hours: 12,
      order: 1,
    },
    {
      description:
        'Высокий уровень ложных срабатываний правил корреляции на этапе опытной эксплуатации — дополнительные итерации тюнинга.',
      hours: 16,
      order: 2,
    },
    {
      description:
        'Задержка оформления Заказчиком подключения к технической инфраструктуре ГосСОПКА (соглашение с НКЦКИ).',
      hours: 8,
      order: 3,
    },
  ],
};
