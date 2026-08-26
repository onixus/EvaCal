import { IndustryPreset } from '../types';

/**
 * Миграция ИТ-инфраструктуры на отечественный стек (импортозамещение).
 *
 * Типовой проект 2024–2026 гг.: замена VMware vSphere на zVirt,
 * Microsoft Active Directory на ALD Pro, Windows на Astra Linux / РЕД ОС,
 * Oracle / MS SQL на Postgres Pro. Нормативная база: Указы Президента РФ
 * № 166 (30.03.2022) и № 250 (01.05.2022) — запрет иностранного ПО на
 * значимых объектах КИИ с 01.01.2025, 188-ФЗ и ПП РФ № 1236.
 */
export const IMPORT_SUBSTITUTION_MIGRATION_PRESET: IndustryPreset = {
  id: 'preset-import-substitution',
  name: 'Импортозамещение: миграция на отечественный стек (zVirt, ALD Pro, Astra, Postgres Pro)',
  category: 'migration',
  description:
    'Комплексный проект миграции ИТ-инфраструктуры на отечественные решения: перенос виртуальных машин с VMware на zVirt, замена Active Directory на ALD Pro, перевод АРМ на Astra Linux / РЕД ОС и миграция баз данных Oracle / MS SQL на Postgres Pro (Указы Президента РФ № 166, № 250; 188-ФЗ).',
  workDayHours: 6,
  includeWeekends: false,
  defaultMarginPercent: 25,
  defaultRoleRates: {
    architect: 5000,
    engineer: 3800,
    analyst: 3400,
    consultant: 4200,
    developer: 3800,
    pm: 4200,
  },
  fields: [
    {
      label: 'Количество мигрируемых виртуальных машин (VMware → zVirt)',
      key: 'vm_count',
      type: 'number',
      required: true,
      order: 0,
    },
    {
      label: 'Количество хостов виртуализации (гипервизоров)',
      key: 'hypervisor_hosts_count',
      type: 'number',
      required: true,
      order: 1,
    },
    {
      label: 'Количество АРМ для перевода на Astra Linux / РЕД ОС',
      key: 'workstations_count',
      type: 'number',
      required: true,
      order: 2,
    },
    {
      label: 'Количество мигрируемых экземпляров БД (Oracle / MS SQL → Postgres Pro)',
      key: 'db_instances_count',
      type: 'number',
      required: true,
      order: 3,
    },
    {
      label: 'Целевая служба каталога',
      key: 'directory_target',
      type: 'select',
      options: ['ALD Pro', 'FreeIPA', 'Samba DC', 'Сохранить текущую (гибрид)'],
      required: true,
      order: 4,
    },
    {
      label: 'Сложность прикладного ландшафта',
      key: 'complexity',
      type: 'complexity',
      required: true,
      order: 5,
    },
    {
      label: 'Перечень прикладного ПО, требующего проверки совместимости',
      key: 'comment',
      type: 'textarea',
      required: false,
      order: 6,
    },
    {
      label: 'Цели создания системы (через точку с запятой)',
      key: 'project_goals',
      type: 'textarea',
      required: false,
      order: 7,
    },
    {
      label: 'Измеримые критерии достижения целей («показатель = целевое значение»)',
      key: 'goal_criteria',
      type: 'textarea',
      required: false,
      order: 8,
    },
  ],
  stageTemplates: [
    {
      name: 'Аудит инфраструктуры и разработка плана миграции',
      role: 'architect',
      baseHours: 32,
      hoursPerUnit: 0.3,
      driverFieldKey: 'vm_count',
      requirements:
        'Инвентаризация серверов, ВМ, АРМ и прикладного ПО; проверка совместимости с отечественным стеком по каталогам совместимости вендоров (Astra Linux Ready, zVirt HCL); карта миграции и план отката.',
      order: 0,
    },
    {
      name: 'Развертывание кластера виртуализации zVirt',
      role: 'engineer',
      baseHours: 24,
      hoursPerUnit: 6,
      driverFieldKey: 'hypervisor_hosts_count',
      requirements:
        'Установка zVirt на хосты, настройка отказоустойчивого кластера, сетей, СХД и высокой доступности ВМ; интеграция с системой резервного копирования.',
      order: 1,
    },
    {
      name: 'Развертывание домена ALD Pro и групповых политик',
      role: 'engineer',
      baseHours: 24,
      hoursPerUnit: 0.2,
      driverFieldKey: 'workstations_count',
      requirements:
        'Установка контроллеров домена ALD Pro, настройка репликации, миграция учетных записей и групп из Active Directory, настройка групповых политик и подключение АРМ.',
      order: 2,
    },
    {
      name: 'Миграция виртуальных машин на zVirt',
      role: 'engineer',
      baseHours: 16,
      hoursPerUnit: 2,
      driverFieldKey: 'vm_count',
      requirements:
        'Конвертация и перенос ВМ (V2V) с VMware на zVirt согласованными волнами, проверка работоспособности сервисов после переноса, актуализация мониторинга и резервного копирования.',
      order: 3,
    },
    {
      name: 'Миграция баз данных на Postgres Pro',
      role: 'developer',
      baseHours: 24,
      hoursPerUnit: 16,
      driverFieldKey: 'db_instances_count',
      requirements:
        'Перенос схем и данных (ora2pg / pgloader), адаптация хранимых процедур и запросов, настройка отказоустойчивости и репликации, нагрузочное тестирование после миграции.',
      order: 4,
    },
    {
      name: 'Перевод АРМ пользователей на Astra Linux / РЕД ОС',
      role: 'engineer',
      baseHours: 16,
      hoursPerUnit: 0.5,
      driverFieldKey: 'workstations_count',
      requirements:
        'Типовой образ АРМ, доменная аутентификация, перенос профилей пользователей, настройка офисного ПО («МойОфис» / «Р7-Офис»), печати и периферии.',
      order: 5,
    },
    {
      name: 'Опытная эксплуатация, обучение и приёмочные испытания по ПМИ',
      role: 'analyst',
      baseHours: 24,
      hoursPerUnit: 0.1,
      driverFieldKey: 'vm_count',
      requirements:
        'Сопровождение опытной эксплуатации, обучение администраторов и пользователей, устранение замечаний, проведение приёмочных испытаний и оформление актов.',
      order: 6,
    },
  ],
  riskTemplates: [
    {
      description:
        'Несовместимость унаследованного прикладного ПО с Linux-средой: потребуется терминальный доступ, Wine или сохранение части Windows-сегмента.',
      hours: 24,
      order: 0,
    },
    {
      description:
        'Превышение согласованных окон простоя при миграции нагруженных БД и критичных сервисов.',
      hours: 16,
      order: 1,
    },
    {
      description:
        'Отсутствие драйверов для специализированной периферии (сканеры, токены, МФУ) под отечественные ОС.',
      hours: 12,
      order: 2,
    },
    {
      description:
        'Задержка предоставления Заказчиком тестового контура для проверки совместимости прикладных систем.',
      hours: 12,
      order: 3,
    },
  ],
};
