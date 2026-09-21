import { IndustryPreset } from '../types';

/**
 * Самостоятельный шаблон внедрения NGFW без смешивания с endpoint, DAP и VPN.
 * Подходит для модернизации периметра, сегментации ЦОД и филиальной сети.
 */
export const NGFW_IMPLEMENTATION_PRESET: IndustryPreset = {
  id: 'preset-ngfw-implementation',
  name: 'Внедрение NGFW и сегментация сетевого периметра',
  category: 'security',
  description:
    'Проект внедрения NGFW: обследование сетевых потоков, проектирование зон и политик, развертывание HA-кластеров, миграция правил, настройка IPS/URL-фильтрации/TLS-инспекции, интеграция с инфраструктурными сервисами и SIEM, опытная эксплуатация и ПМИ.',
  workDayHours: 6,
  includeWeekends: false,
  defaultMarginPercent: 26,
  defaultRoleRates: {
    architect: 5000,
    engineer: 4000,
    analyst: 3500,
    consultant: 4300,
    developer: 3600,
    pm: 4100,
  },
  fields: [
    {
      label: 'Количество HA-кластеров NGFW',
      key: 'ngfw_clusters_count',
      type: 'number',
      required: true,
      order: 0,
    },
    {
      label: 'Количество сетевых зон / сегментов',
      key: 'network_zones_count',
      type: 'number',
      required: true,
      order: 1,
    },
    {
      label: 'Количество правил, подлежащих миграции',
      key: 'rules_count',
      type: 'number',
      required: true,
      order: 2,
    },
    {
      label: 'Количество внешних интеграций (AD/LDAP, DNS, PKI, SIEM, NTP и др.)',
      key: 'integrations_count',
      type: 'number',
      required: true,
      order: 3,
    },
    {
      label: 'Требуется TLS-инспекция',
      key: 'tls_inspection_required',
      type: 'checkbox',
      required: false,
      order: 4,
    },
    {
      label: 'Требуется интеграция с SIEM',
      key: 'siem_integration_required',
      type: 'checkbox',
      required: false,
      order: 5,
    },
    {
      label: 'Сложность сетевого контура',
      key: 'complexity',
      type: 'complexity',
      required: true,
      order: 6,
    },
    {
      label: 'Дополнительные требования к NGFW',
      key: 'comment',
      type: 'textarea',
      required: false,
      order: 7,
    },
    {
      label: 'Цели создания системы (через точку с запятой)',
      key: 'project_goals',
      type: 'textarea',
      required: false,
      order: 8,
    },
    {
      label: 'Измеримые критерии достижения целей («показатель = целевое значение»)',
      key: 'goal_criteria',
      type: 'textarea',
      required: false,
      order: 9,
    },
  ],
  stageTemplates: [
    {
      name: 'Обследование сетевых потоков и инвентаризация политик',
      role: 'analyst',
      baseHours: 28,
      hoursPerUnit: 0.08,
      driverFieldKey: 'rules_count',
      requirements:
        'Исполнитель обязан собрать текущие схемы, таблицы маршрутизации и правила фильтрации, определить владельцев сервисов, выявить дублирующие и неиспользуемые правила и сформировать базовую матрицу сетевых взаимодействий.',
      order: 0,
    },
    {
      name: 'Проектирование архитектуры NGFW, зон и политики миграции',
      role: 'architect',
      baseHours: 32,
      hoursPerUnit: 2,
      driverFieldKey: 'network_zones_count',
      requirements:
        'Исполнитель обязан разработать целевую схему размещения NGFW, зоны безопасности, маршрутизацию, HA, NAT, требования к IPS, URL-фильтрации и TLS-инспекции, а также последовательность миграции с планом отката.',
      order: 1,
    },
    {
      name: 'Развертывание и кластеризация NGFW',
      role: 'engineer',
      baseHours: 20,
      hoursPerUnit: 18,
      driverFieldKey: 'ngfw_clusters_count',
      requirements:
        'Исполнитель обязан установить и обновить NGFW, создать HA-кластеры, настроить интерфейсы, маршрутизацию, синхронизацию состояния, административный доступ, резервное копирование и мониторинг состояния.',
      order: 2,
    },
    {
      name: 'Миграция и оптимизация правил межсетевого экранирования',
      role: 'engineer',
      baseHours: 20,
      hoursPerUnit: 0.25,
      driverFieldKey: 'rules_count',
      requirements:
        'Исполнитель обязан перенести согласованные правила, объекты и NAT-политики, выполнить дедупликацию и нормализацию, проверить принцип минимально необходимых доступов и документировать отклонения от исходной конфигурации.',
      order: 3,
    },
    {
      name: 'Настройка сервисов безопасности и внешних интеграций',
      role: 'engineer',
      baseHours: 20,
      hoursPerUnit: 6,
      driverFieldKey: 'integrations_count',
      requirements:
        'Исполнитель обязан настроить IPS, URL-фильтрацию, контроль приложений и при необходимости TLS-инспекцию, а также интеграции с AD/LDAP, DNS, NTP, PKI, SIEM и иными сервисами Заказчика.',
      order: 4,
    },
    {
      name: 'Опытная эксплуатация, переключение, обучение и ПМИ',
      role: 'consultant',
      baseHours: 32,
      hoursPerUnit: 4,
      driverFieldKey: 'ngfw_clusters_count',
      requirements:
        'Исполнитель обязан провести тестовое и промышленное переключение по согласованному окну, проверить отказоустойчивость и ключевые бизнес-сервисы, обучить администраторов и провести приемочные испытания по ПМИ.',
      order: 5,
    },
  ],
  riskTemplates: [
    {
      description:
        'Фактические сетевые зависимости не отражены в документации, что может привести к дополнительным итерациям анализа и миграции правил.',
      hours: 20,
      order: 0,
    },
    {
      description:
        'Окно переключения ограничено, а план возврата к исходной схеме не проверен на тестовом контуре.',
      hours: 16,
      order: 1,
    },
    {
      description:
        'TLS-инспекция затрагивает приложения с certificate pinning или нестандартной криптографией и потребует исключений.',
      hours: 16,
      order: 2,
    },
    {
      description:
        'Существующий набор правил содержит значительный объем неиспользуемых и конфликтующих политик, требующих согласования владельцами сервисов.',
      hours: 20,
      order: 3,
    },
  ],
};
