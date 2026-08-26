import { IndustryPreset } from '../types';

/**
 * Резервное копирование и катастрофоустойчивость (Кибер Бэкап / RuBackup).
 *
 * Типовой проект построения подсистемы резервного копирования на
 * отечественном ПО с целевыми показателями RPO/RTO, защитой от
 * шифровальщиков (неизменяемые копии, правило 3-2-1) и репликацией
 * на резервную площадку.
 */
export const BACKUP_DR_PRESET: IndustryPreset = {
  id: 'preset-backup-dr',
  name: 'Резервное копирование и катастрофоустойчивость (Кибер Бэкап / RuBackup)',
  category: 'infrastructure',
  description:
    'Проект построения подсистемы резервного копирования и восстановления на отечественном ПО (Кибер Бэкап, RuBackup): политика РК по правилу 3-2-1, неизменяемые копии для защиты от шифровальщиков, репликация на резервную площадку и регулярные тестовые восстановления с контролем RPO/RTO.',
  workDayHours: 6,
  includeWeekends: false,
  defaultMarginPercent: 22,
  defaultRoleRates: {
    architect: 4800,
    engineer: 3700,
    analyst: 3200,
    consultant: 4000,
    developer: 3500,
    pm: 4000,
  },
  fields: [
    {
      label: 'Количество защищаемых физических серверов',
      key: 'protected_servers_count',
      type: 'number',
      required: true,
      order: 0,
    },
    {
      label: 'Количество защищаемых виртуальных машин',
      key: 'protected_vms_count',
      type: 'number',
      required: true,
      order: 1,
    },
    {
      label: 'Объём защищаемых данных (ТБ)',
      key: 'backup_volume_tb',
      type: 'number',
      required: true,
      order: 2,
    },
    {
      label: 'Резервная площадка (DR)',
      key: 'dr_site',
      type: 'select',
      options: [
        'Не требуется',
        'Холодный резерв (репликация копий)',
        'Горячий резерв (репликация + план переключения)',
      ],
      required: true,
      order: 3,
    },
    {
      label: 'Сложность ландшафта резервного копирования',
      key: 'complexity',
      type: 'complexity',
      required: true,
      order: 4,
    },
    {
      label: 'Целевые RPO/RTO и особые требования (СУБД, почта, файловые хранилища)',
      key: 'comment',
      type: 'textarea',
      required: false,
      order: 5,
    },
  ],
  stageTemplates: [
    {
      name: 'Аудит данных и разработка политики резервного копирования',
      role: 'architect',
      baseHours: 24,
      hoursPerUnit: 0.4,
      driverFieldKey: 'protected_vms_count',
      requirements:
        'Классификация защищаемых систем и данных, согласование целевых RPO/RTO по каждому классу, расчёт ёмкости хранилища копий с учётом ретенции и дедупликации, схема по правилу 3-2-1.',
      order: 0,
    },
    {
      name: 'Развертывание серверов управления и хранилищ копий',
      role: 'engineer',
      baseHours: 24,
      hoursPerUnit: 1,
      driverFieldKey: 'backup_volume_tb',
      requirements:
        'Установка сервера управления Кибер Бэкап / RuBackup, узлов хранения и дедупликации, настройка неизменяемых (immutable) хранилищ для защиты от шифровальщиков.',
      order: 1,
    },
    {
      name: 'Подключение защищаемых машин и приложений',
      role: 'engineer',
      baseHours: 12,
      hoursPerUnit: 0.6,
      driverFieldKey: 'protected_vms_count',
      requirements:
        'Установка агентов и безагентная защита виртуальных сред, консистентные копии СУБД (PostgreSQL / Postgres Pro, 1С), настройка расписаний полных и инкрементальных копий.',
      order: 2,
    },
    {
      name: 'Настройка репликации на резервную площадку и плана DR',
      role: 'engineer',
      baseHours: 20,
      hoursPerUnit: 2,
      driverFieldKey: 'protected_servers_count',
      requirements:
        'Репликация резервных копий на вторую площадку, план аварийного восстановления (DRP) с порядком и приоритетами восстановления сервисов, автоматизация переключения при горячем резерве.',
      order: 3,
    },
    {
      name: 'Тестовые восстановления, регламенты и ПМИ',
      role: 'consultant',
      baseHours: 20,
      hoursPerUnit: 0.2,
      driverFieldKey: 'protected_vms_count',
      requirements:
        'Контрольные восстановления каждого класса систем с замером фактических RTO/RPO, регламент регулярных тестов восстановления, инструкции администраторов, приёмочные испытания по ПМИ.',
      order: 4,
    },
  ],
  riskTemplates: [
    {
      description:
        'Недостаточная ёмкость или производительность хранилища под резервные копии с учётом ретенции — потребуется дозакупка.',
      hours: 12,
      order: 0,
    },
    {
      description:
        'Окно резервного копирования не вмещает полный цикл копирования нагруженных систем — пересмотр расписаний и цепочек.',
      hours: 12,
      order: 1,
    },
    {
      description:
        'Пропускная способность канала до резервной площадки недостаточна для репликации в целевые сроки.',
      hours: 10,
      order: 2,
    },
  ],
};
