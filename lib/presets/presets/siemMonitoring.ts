import { IndustryPreset } from '../types';

/**
 * Полный пресейл-опросник SIEM / SOC.
 *
 * Поля разделены по смыслу самим порядком: контур → нагрузка → хранение →
 * интеграции → эксплуатация. Автоматический sizing строится в
 * lib/presets/implementationSizing.ts и намеренно остается вендор-нейтральным.
 */
export const SIEM_MONITORING_PRESET: IndustryPreset = {
  id: 'preset-siem-soc',
  name: 'Внедрение SIEM и мониторинга ИБ (SOC / ГосСОПКА)',
  category: 'monitoring',
  description:
    'Полный пресейл-профиль SIEM/SOC: источники и площадки, EPS и размер события, ретенция, HA коллекторов и платформы, правила корреляции, IRP/SOAR/TI/Service Desk, ГосСОПКА, требования к доступности и эксплуатации.',
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
      label: 'Количество подключаемых источников событий',
      key: 'event_sources_count',
      type: 'number',
      required: true,
      order: 0,
    },
    {
      label: 'Количество площадок / ЦОД / филиальных узлов сбора',
      key: 'sites_count',
      type: 'number',
      required: true,
      order: 1,
    },
    {
      label: 'Средний поток событий (EPS)',
      key: 'eps_estimate',
      type: 'number',
      required: true,
      order: 2,
    },
    {
      label: 'Коэффициент пикового потока относительно среднего EPS',
      key: 'eps_peak_factor',
      type: 'select',
      options: ['1.5', '2', '3', '4'],
      required: true,
      order: 3,
    },
    {
      label: 'Средний размер одного события, байт',
      key: 'avg_event_size_bytes',
      type: 'number',
      required: true,
      order: 4,
    },
    {
      label: 'Оперативная ретенция (hot), суток',
      key: 'hot_retention_days',
      type: 'number',
      required: true,
      order: 5,
    },
    {
      label: 'Архивная ретенция, суток',
      key: 'archive_retention_days',
      type: 'number',
      required: true,
      order: 6,
    },
    {
      label: 'Ожидаемый коэффициент сжатия данных',
      key: 'compression_ratio',
      type: 'number',
      required: false,
      order: 7,
    },
    {
      label: 'Количество нестандартных источников / кастомных парсеров',
      key: 'custom_connectors_count',
      type: 'number',
      required: true,
      order: 8,
    },
    {
      label: 'Количество сценариев / правил корреляции к вводу',
      key: 'correlation_rules_count',
      type: 'number',
      required: true,
      order: 9,
    },
    {
      label: 'Количество внешних интеграций (IRP/SOAR/TI/Service Desk и др.)',
      key: 'siem_integrations_count',
      type: 'number',
      required: true,
      order: 10,
    },
    {
      label: 'Требуется резервирование коллекторов',
      key: 'collector_ha_required',
      type: 'checkbox',
      required: false,
      order: 11,
    },
    {
      label: 'Требуется HA критических компонентов SIEM',
      key: 'platform_ha_required',
      type: 'checkbox',
      required: false,
      order: 12,
    },
    {
      label: 'Целевая доступность SIEM, %',
      key: 'availability_target_percent',
      type: 'number',
      required: true,
      order: 13,
    },
    {
      label: 'Требуется взаимодействие с ГосСОПКА / НКЦКИ',
      key: 'gossopka_required',
      type: 'checkbox',
      required: false,
      order: 14,
    },
    {
      label: 'Целевая SIEM-платформа',
      key: 'siem_platform',
      type: 'select',
      options: ['MaxPatrol SIEM', 'Kaspersky KUMA', 'RuSIEM', 'Определить по результатам пилота'],
      required: true,
      order: 15,
    },
    {
      label: 'Модель SOC',
      key: 'soc_model',
      type: 'select',
      options: [
        'Внутренний SOC',
        'MSSP / внешний SOC',
        'Гибридная модель',
        'Только SIEM без отдельного SOC',
      ],
      required: true,
      order: 16,
    },
    {
      label: 'Количество операторов и аналитиков SOC',
      key: 'soc_users_count',
      type: 'number',
      required: false,
      order: 17,
    },
    {
      label: 'Требуемое время доставки события до SIEM, секунд',
      key: 'event_delivery_sla_seconds',
      type: 'number',
      required: false,
      order: 18,
    },
    {
      label: 'Требуемый срок первичной реакции на критический инцидент, минут',
      key: 'incident_response_sla_minutes',
      type: 'number',
      required: false,
      order: 19,
    },
    {
      label: 'Сложность инфраструктуры мониторинга',
      key: 'complexity',
      type: 'complexity',
      required: true,
      order: 20,
    },
    {
      label: 'Дополнительные требования / ограничения',
      key: 'comment',
      type: 'textarea',
      required: false,
      order: 21,
    },
    {
      label: 'Цели создания системы (через точку с запятой)',
      key: 'project_goals',
      type: 'textarea',
      required: false,
      order: 22,
    },
    {
      label: 'Измеримые критерии достижения целей («показатель = целевое значение»)',
      key: 'goal_criteria',
      type: 'textarea',
      required: false,
      order: 23,
    },
  ],
  stageTemplates: [
    {
      name: 'Обследование и инвентаризация источников событий',
      role: 'analyst',
      baseHours: 28,
      hoursPerUnit: 0.45,
      driverFieldKey: 'event_sources_count',
      requirements:
        'Исполнитель обязан инвентаризировать источники и площадки, зафиксировать форматы журналов, владельцев, режимы аудита, фактический средний/пиковый EPS и подготовить матрицу подключения.',
      order: 0,
    },
    {
      name: 'Архитектура, сайзинг и схема сбора событий',
      role: 'architect',
      baseHours: 36,
      hoursPerUnit: 5,
      driverFieldKey: 'sites_count',
      requirements:
        'Исполнитель обязан разработать целевую архитектуру сбора, рассчитать ingest и уровни хранения по EPS/ретенции, определить HA, сетевые потоки, требования к вычислительным ресурсам и план масштабирования.',
      order: 1,
    },
    {
      name: 'Развертывание и сайзинг платформы SIEM',
      role: 'engineer',
      baseHours: 44,
      hoursPerUnit: 4,
      driverFieldKey: 'sites_count',
      requirements:
        'Исполнитель обязан установить ядро, коллекторы и хранилище, настроить HA, ретенцию, мониторинг компонентов, резервное копирование конфигурации и ролевой административный доступ.',
      order: 2,
    },
    {
      name: 'Подключение и нормализация источников событий',
      role: 'engineer',
      baseHours: 18,
      hoursPerUnit: 1.5,
      driverFieldKey: 'event_sources_count',
      requirements:
        'Исполнитель обязан подключить типовые источники, настроить аудит, нормализацию, категоризацию, контроль задержки и полноты поступления, а также диагностику остановки потока событий.',
      order: 3,
    },
    {
      name: 'Разработка нестандартных коннекторов и парсеров',
      role: 'developer',
      baseHours: 8,
      hoursPerUnit: 12,
      driverFieldKey: 'custom_connectors_count',
      requirements:
        'Исполнитель обязан разработать и протестировать парсеры/коннекторы для нестандартных источников, документировать формат входных данных, обработку ошибок и правила версионирования.',
      order: 4,
    },
    {
      name: 'Разработка и тюнинг сценариев корреляции',
      role: 'analyst',
      baseHours: 20,
      hoursPerUnit: 3,
      driverFieldKey: 'correlation_rules_count',
      requirements:
        'Исполнитель обязан реализовать согласованные use cases, настроить приоритеты и контекст, провести позитивные и негативные проверки и тюнинг ложных срабатываний на данных Заказчика.',
      order: 5,
    },
    {
      name: 'Регламенты реагирования и внешние интеграции',
      role: 'consultant',
      baseHours: 28,
      hoursPerUnit: 8,
      driverFieldKey: 'siem_integrations_count',
      requirements:
        'Исполнитель обязан настроить согласованные интеграции IRP/SOAR/TI/Service Desk, разработать регламенты мониторинга и реагирования и при применимости порядок взаимодействия с ГосСОПКА/НКЦКИ.',
      order: 6,
    },
    {
      name: 'Опытная эксплуатация, обучение SOC и приемочные испытания',
      role: 'analyst',
      baseHours: 32,
      hoursPerUnit: 0.2,
      driverFieldKey: 'event_sources_count',
      requirements:
        'Исполнитель обязан провести опытную эксплуатацию, нагрузочную проверку ingest, тестирование use cases, failover критических компонентов, обучение персонала и приемочные испытания по ПМИ.',
      order: 7,
    },
  ],
  riskTemplates: [
    {
      description:
        'На части источников отсутствует требуемый аудит или журналы имеют нестабильный формат; потребуется доработка политик логирования и повторная приемка.',
      hours: 20,
      order: 0,
    },
    {
      description:
        'Фактический средний или пиковый EPS выше пресейл-оценки; потребуется пересмотр вычислительных ресурсов, хранилища и лицензирования.',
      hours: 20,
      order: 1,
    },
    {
      description:
        'Фактический размер и сжимаемость событий отличаются от исходных предположений, что изменит емкость hot/archive хранения.',
      hours: 12,
      order: 2,
    },
    {
      description:
        'Высокий уровень ложных срабатываний потребует дополнительных итераций тюнинга правил корреляции и исключений.',
      hours: 20,
      order: 3,
    },
    {
      description:
        'Нестандартные источники не имеют стабильного API/формата журналов и потребуют разработки и сопровождения кастомных коннекторов.',
      hours: 16,
      order: 4,
    },
  ],
};
