import { IndustryPreset } from '../types';

export const CUSTOM_DEVELOPMENT_API_PRESET: IndustryPreset = {
  id: 'preset-custom-development-api',
  name: 'Заказная разработка и интеграции (Микросервисы, REST/Kafka, 1С, СМЭВ)',
  category: 'development',
  description:
    'Проект заказной разработки корпоративной информационной системы, интеграционной шины данных, сервисов обмена по REST/SOAP/Kafka, интеграции с 1С:ERP и государственными сервисами (СМЭВ/ЕАИС).',
  workDayHours: 6,
  includeWeekends: false,
  defaultMarginPercent: 22,
  defaultRoleRates: {
    architect: 4600,
    engineer: 3500,
    analyst: 3400,
    consultant: 3800,
    developer: 3800,
    pm: 3800,
  },
  fields: [
    {
      label: 'Количество внешних систем и шлюзов интеграции (1C, СМЭВ, Kafka, CRM)',
      key: 'integrations_count',
      type: 'number',
      required: true,
      order: 0,
    },
    {
      label: 'Количество пользовательских экранных форм и отчетов',
      key: 'screens_count',
      type: 'number',
      required: true,
      order: 1,
    },
    {
      label: 'Количество бизнес-сущностей и моделей данных',
      key: 'entities_count',
      type: 'number',
      required: true,
      order: 2,
    },
    {
      label: 'Сложность бизнес-логики и сценариев обработки',
      key: 'complexity',
      type: 'complexity',
      required: true,
      order: 3,
    },
    {
      label: 'Требования к отказоустойчивости, шифрованию каналов и очередям',
      key: 'comment',
      type: 'textarea',
      required: false,
      order: 4,
    },
  ],
  stageTemplates: [
    {
      name: 'Системный анализ, прототипирование UI/UX и ТЗ по ГОСТ 34.602',
      role: 'analyst',
      baseHours: 24,
      hoursPerUnit: 2.5,
      driverFieldKey: 'screens_count',
      requirements:
        'Детализация требований пользователей, проектирование экранов, макетов, валидаций и подготовка ТЗ на систему.',
      order: 0,
    },
    {
      name: 'Проектирование архитектуры сервисов, схем БД и спецификаций API (OpenAPI/AsyncAPI)',
      role: 'architect',
      baseHours: 24,
      hoursPerUnit: 4,
      driverFieldKey: 'entities_count',
      requirements:
        'Главный архитектор проекта: декомпозиция на микросервисы, модели данных Postgres, протоколы взаимодействия и схемы очередей Kafka.',
      order: 1,
    },
    {
      name: 'Разработка интеграционных адаптеров и коннекторов к шине (1C, СМЭВ, Kafka)',
      role: 'developer',
      baseHours: 20,
      hoursPerUnit: 14,
      driverFieldKey: 'integrations_count',
      requirements:
        'Реализация REST/SOAP клиентов, обработчиков очередей, маппинга структур данных, механизмов повтора (retry/backoff) и транзакционных логов.',
      order: 2,
    },
    {
      name: 'Разработка прикладных сервисов бизнес-логики и веб-интерфейса',
      role: 'developer',
      baseHours: 32,
      hoursPerUnit: 6,
      driverFieldKey: 'screens_count',
      requirements:
        'Реализация backend API, валидаций, бизнес-правил, ролевой модели (RBAC) и responsive frontend интерфейсов.',
      order: 3,
    },
    {
      name: 'Комплексное интеграционное и нагрузочное тестирование по ПМИ',
      role: 'engineer',
      baseHours: 20,
      hoursPerUnit: 3,
      driverFieldKey: 'screens_count',
      requirements:
        'Автоматизированные e2e тесты, нагрузочное тестирование пиковых TPS, валидация устойчивости при сбоях интеграционных шин.',
      order: 4,
    },
    {
      name: 'Опытная эксплуатация, обучение персонала и сдача системы Заказчику',
      role: 'analyst',
      baseHours: 16,
      hoursPerUnit: 2,
      driverFieldKey: 'integrations_count',
      requirements:
        'Разработка Руководства пользователя, Руководства администратора, проведение обучающих вебинаров и авторский надзор.',
      order: 5,
    },
  ],
  riskTemplates: [
    {
      description:
        'Изменение форматов и протоколов обмена со стороны внешних систем (1С/СМЭВ) в процессе разработки.',
      hours: 20,
      order: 0,
    },
    {
      description: 'Отсутствие или нестабильность тестовых стендов смежных систем Заказчика.',
      hours: 16,
      order: 1,
    },
    {
      description:
        'Длительное согласование экранных интерфейсов и дополнительных полей со стороны ключевых пользователей.',
      hours: 12,
      order: 2,
    },
  ],
};
