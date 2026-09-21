import { IndustryPreset } from '../types';

/**
 * Внедрение IDM / IGA: централизованное управление учетными записями,
 * ролями и жизненным циклом доступа.
 *
 * Шаблон вендор-нейтрален: целевая платформа выбирается на обследовании.
 * В качестве вариантов могут использоваться российские IDM/IGA-платформы
 * и корпоративные каталоги, если они соответствуют требованиям Заказчика.
 */
export const IDM_ACCESS_MANAGEMENT_PRESET: IndustryPreset = {
  id: 'preset-idm-access-management',
  name: 'Внедрение IDM / IGA и управление жизненным циклом доступа',
  category: 'security',
  description:
    'Проект внедрения централизованного управления идентификацией и доступом: обследование источников идентичностей, модель ролей и полномочий, интеграция кадровых систем и каталогов, процессы Joiner/Mover/Leaver, заявки и согласования доступа, периодическая рекертификация и приемочные испытания.',
  workDayHours: 6,
  includeWeekends: false,
  defaultMarginPercent: 28,
  defaultRoleRates: {
    architect: 5000,
    engineer: 4000,
    analyst: 3800,
    consultant: 4400,
    developer: 4000,
    pm: 4200,
  },
  fields: [
    {
      label: 'Количество управляемых учетных записей',
      key: 'identities_count',
      type: 'number',
      required: true,
      order: 0,
    },
    {
      label: 'Количество целевых систем для интеграции',
      key: 'target_systems_count',
      type: 'number',
      required: true,
      order: 1,
    },
    {
      label: 'Количество кадровых/мастер-систем идентичностей',
      key: 'authoritative_sources_count',
      type: 'number',
      required: true,
      order: 2,
    },
    {
      label: 'Количество бизнес-ролей для моделирования',
      key: 'business_roles_count',
      type: 'number',
      required: true,
      order: 3,
    },
    {
      label: 'Требуется рекертификация прав доступа',
      key: 'recertification_required',
      type: 'checkbox',
      required: false,
      order: 4,
    },
    {
      label: 'Требуется управление привилегированными учетными записями (интеграция с PAM)',
      key: 'pam_integration_required',
      type: 'checkbox',
      required: false,
      order: 5,
    },
    {
      label: 'Сложность модели доступа',
      key: 'complexity',
      type: 'complexity',
      required: true,
      order: 6,
    },
    {
      label: 'Дополнительные требования к IDM / IGA',
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
      name: 'Обследование идентичностей, каталогов и процессов доступа',
      role: 'analyst',
      baseHours: 32,
      hoursPerUnit: 3,
      driverFieldKey: 'authoritative_sources_count',
      requirements:
        'Исполнитель обязан инвентаризировать источники идентичностей, каталоги, кадровые процессы, целевые системы и текущие процедуры выдачи и отзыва доступа; сформировать реестр интеграций и перечень владельцев ресурсов.',
      order: 0,
    },
    {
      name: 'Проектирование целевой архитектуры IDM / IGA и модели ролей',
      role: 'architect',
      baseHours: 40,
      hoursPerUnit: 2,
      driverFieldKey: 'business_roles_count',
      requirements:
        'Исполнитель обязан разработать целевую архитектуру IDM / IGA, модель ролей и полномочий, матрицу SoD, правила Joiner/Mover/Leaver, модель согласований и требования к журналированию административных действий.',
      order: 1,
    },
    {
      name: 'Развертывание платформы IDM / IGA и базовая конфигурация',
      role: 'engineer',
      baseHours: 40,
      hoursPerUnit: 0,
      driverFieldKey: null,
      requirements:
        'Исполнитель обязан установить компоненты платформы, настроить отказоустойчивость, резервное копирование, разграничение административных ролей, аудит и защищенные каналы взаимодействия между компонентами.',
      order: 2,
    },
    {
      name: 'Интеграция мастер-систем и целевых информационных систем',
      role: 'developer',
      baseHours: 24,
      hoursPerUnit: 12,
      driverFieldKey: 'target_systems_count',
      requirements:
        'Исполнитель обязан подключить кадровые и справочные мастер-системы, каталоги и целевые приложения, настроить коннекторы, преобразование атрибутов, провижининг, блокировку и удаление учетных записей с обработкой ошибок синхронизации.',
      order: 3,
    },
    {
      name: 'Настройка процессов заявок, согласований и рекертификации',
      role: 'consultant',
      baseHours: 32,
      hoursPerUnit: 1.5,
      driverFieldKey: 'business_roles_count',
      requirements:
        'Исполнитель обязан реализовать каталоги доступа, маршруты заявок и согласований, делегирование полномочий, периодический пересмотр прав, контроль конфликтов полномочий и отчетность по жизненному циклу доступа.',
      order: 4,
    },
    {
      name: 'Миграция, опытная эксплуатация, обучение и ПМИ',
      role: 'analyst',
      baseHours: 28,
      hoursPerUnit: 0.03,
      driverFieldKey: 'identities_count',
      requirements:
        'Исполнитель обязан выполнить контролируемую загрузку идентичностей и назначений, провести сверку прав, организовать опытную эксплуатацию, обучение администраторов и владельцев ресурсов и приемочные испытания по ПМИ.',
      order: 5,
    },
  ],
  riskTemplates: [
    {
      description:
        'Отсутствует единый достоверный источник кадровых данных или качество атрибутов недостаточно для автоматизированного провижининга.',
      hours: 24,
      order: 0,
    },
    {
      description:
        'Целевые системы не имеют штатных API/коннекторов и потребуют разработки или доработки интеграций.',
      hours: 24,
      order: 1,
    },
    {
      description:
        'Ролевая модель и владельцы ресурсов не согласованы до начала настройки процессов доступа.',
      hours: 20,
      order: 2,
    },
    {
      description:
        'Обнаружены конфликтующие или избыточные права при первичной рекертификации, потребуется дополнительная волна очистки доступов.',
      hours: 20,
      order: 3,
    },
  ],
};
