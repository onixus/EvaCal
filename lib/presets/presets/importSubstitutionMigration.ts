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
        'Исполнитель обязан провести инвентаризацию серверов, ВМ, АРМ и прикладного ПО, проверить совместимость с отечественным стеком по каталогам совместимости вендоров (Astra Linux Ready, zVirt HCL) и подготовить карту миграции и план отката.',
      order: 0,
    },
    {
      name: 'Развертывание кластера виртуализации zVirt',
      role: 'engineer',
      baseHours: 24,
      hoursPerUnit: 6,
      driverFieldKey: 'hypervisor_hosts_count',
      requirements:
        'Исполнитель обязан установить zVirt на хосты, настроить отказоустойчивый кластер, сети, СХД и режим HA для виртуальных машин, а также выполнить интеграцию с системой резервного копирования.',
      order: 1,
    },
    {
      name: 'Развертывание домена ALD Pro и групповых политик',
      role: 'engineer',
      baseHours: 24,
      hoursPerUnit: 0.2,
      driverFieldKey: 'workstations_count',
      requirements:
        'Исполнитель обязан установить контроллеры домена ALD Pro, настроить репликацию, мигрировать учетные записи и группы из Active Directory, настроить групповые политики и подключить АРМ.',
      order: 2,
    },
    {
      name: 'Миграция виртуальных машин на zVirt',
      role: 'engineer',
      baseHours: 16,
      hoursPerUnit: 2,
      driverFieldKey: 'vm_count',
      requirements:
        'Исполнитель обязан выполнить конвертацию и перенос ВМ (V2V) с VMware на zVirt согласованными волнами, проверить работоспособность сервисов после переноса и актуализировать мониторинг и резервное копирование.',
      order: 3,
    },
    {
      name: 'Миграция баз данных на Postgres Pro',
      role: 'developer',
      baseHours: 24,
      hoursPerUnit: 16,
      driverFieldKey: 'db_instances_count',
      requirements:
        'Исполнитель обязан перенести схемы и данные (ora2pg / pgloader), адаптировать хранимые процедуры и запросы, настроить отказоустойчивость и репликацию и провести нагрузочное тестирование после миграции.',
      order: 4,
    },
    {
      name: 'Перевод АРМ пользователей на Astra Linux / РЕД ОС',
      role: 'engineer',
      baseHours: 16,
      hoursPerUnit: 0.5,
      driverFieldKey: 'workstations_count',
      requirements:
        'Исполнитель обязан подготовить типовой образ АРМ, настроить доменную аутентификацию, перенести профили пользователей и настроить офисное ПО («МойОфис» / «Р7-Офис»), печать и периферию.',
      order: 5,
    },
    {
      name: 'Опытная эксплуатация, обучение и приёмочные испытания по ПМИ',
      role: 'analyst',
      baseHours: 24,
      hoursPerUnit: 0.1,
      driverFieldKey: 'vm_count',
      requirements:
        'Исполнитель обязан обеспечить сопровождение опытной эксплуатации, провести обучение администраторов и пользователей, устранить замечания, провести приёмочные испытания и оформить акты.',
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
