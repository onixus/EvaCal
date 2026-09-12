import { IndustryPreset } from '../types';

export const ERP_CRM_ENTERPRISE_PRESET: IndustryPreset = {
  id: 'preset-erp-crm-enterprise',
  name: 'Внедрение корпоративной ERP/CRM системы (1С:ERP, отечественные платформы)',
  category: 'development',
  description:
    'Комплексный проект автоматизации предприятия: закупки, склад, производство, продажи, казначейство, регламентированный учёт, миграция НСИ и интеграция со смежными сервисами.',
  workDayHours: 6,
  includeWeekends: false,
  defaultMarginPercent: 22,
  defaultRoleRates: {
    architect: 4600,
    engineer: 3500,
    analyst: 3600,
    consultant: 3800,
    developer: 3800,
    pm: 4000,
  },
  fields: [
    {
      label: 'Количество функциональных модулей (Казначейство, Склад, Закупки, Производство и др.)',
      key: 'modules_count',
      type: 'number',
      required: true,
      order: 0,
    },
    {
      label: 'Плановое количество автоматизированных рабочих мест (АРМ пользователей)',
      key: 'workplaces_count',
      type: 'number',
      required: true,
      order: 1,
    },
    {
      label: 'Количество унаследованных баз и источников для миграции данных',
      key: 'legacy_databases_count',
      type: 'number',
      required: true,
      order: 2,
    },
    {
      label: 'Количество внешних интерфейсов интеграции (EDI, Банки, WMS, CRM, СЭД)',
      key: 'integrations_count',
      type: 'number',
      required: true,
      order: 3,
    },
    {
      label: 'Сложность отраслевой специфики и доработок типового функционала',
      key: 'complexity',
      type: 'complexity',
      required: true,
      order: 4,
    },
    {
      label: 'Особые требования к разграничению прав доступа, закрытию периода и регламентам',
      key: 'comment',
      type: 'textarea',
      required: false,
      order: 5,
    },
  ],
  stageTemplates: [
    {
      name: 'Предпроектное обследование и разработка концептуального дизайна системы',
      role: 'analyst',
      baseHours: 32,
      hoursPerUnit: 4,
      driverFieldKey: 'modules_count',
      requirements:
        'Интервьюирование владельцев процессов, моделирование процессов AS-IS/TO-BE, согласование функциональных разрывов (GAP-анализ).',
      order: 0,
    },
    {
      name: 'Техническое проектирование архитектуры СУБД и спецификаций интеграций',
      role: 'architect',
      baseHours: 24,
      hoursPerUnit: 5,
      driverFieldKey: 'integrations_count',
      requirements:
        'Проектирование схемы масштабирования СУБД Postgres/1С, структуры очередей сообщений и форматов обмена.',
      order: 1,
    },
    {
      name: 'Адаптация типовой конфигурации, разработка доработок и бизнес-логики',
      role: 'developer',
      baseHours: 40,
      hoursPerUnit: 8,
      driverFieldKey: 'modules_count',
      requirements:
        'Кастомизация печатных форм, алгоритмов распределения затрат, маршрутов согласования и специфических документов.',
      order: 2,
    },
    {
      name: 'Разработка конвертеров данных, выверка и миграция НСИ и остатков',
      role: 'engineer',
      baseHours: 24,
      hoursPerUnit: 12,
      driverFieldKey: 'legacy_databases_count',
      requirements:
        'Очистка, дедупликация и загрузка нормативно-справочной информации, перенос входящих остатков по счетам.',
      order: 3,
    },
    {
      name: 'Комплексное сквозное тестирование сценариев и нагрузочные замеры',
      role: 'engineer',
      baseHours: 24,
      hoursPerUnit: 0.2,
      driverFieldKey: 'workplaces_count',
      requirements:
        'Проверка времени проведения групповых документов, проведение регламентных операций закрытия месяца.',
      order: 4,
    },
    {
      name: 'Обучение ключевых пользователей и опытно-промышленная эксплуатация',
      role: 'consultant',
      baseHours: 20,
      hoursPerUnit: 0.3,
      driverFieldKey: 'workplaces_count',
      requirements:
        'Обучение пользователей по ролевым профилям, подготовка инструкций, дежурство группы сопровождения запуска.',
      order: 5,
    },
  ],
  riskTemplates: [
    {
      description:
        'Низкое качество и дублирование нормативно-справочной информации в исторических базах Заказчика.',
      hours: 24,
      order: 0,
    },
    {
      description:
        'Задержка согласования целевых регламентов процессов TO-BE со стороны подразделений.',
      hours: 20,
      order: 1,
    },
    {
      description:
        'Нестабильность работы сторонних интеграционных шлюзов (EDI-провайдеры, банки).',
      hours: 16,
      order: 2,
    },
  ],
};
