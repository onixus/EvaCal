import { IndustryPreset } from '../types';

export const HARDWARE_PAC_DB_PRESET: IndustryPreset = {
  id: 'preset-hardware-pac-db',
  name: 'Поставка и ПНР ПАК (Серверы YADRO/Aquarius, ОС Astra Linux, СУБД Postgres Pro)',
  category: 'hardware_pac',
  description:
    'Комплексный проект поставки серверного оборудования, СХД, коммутаторов, монтажа в стойки, пусконаладки (ПНР), установки защищенной ОС Astra Linux SE и отказоустойчивой СУБД Postgres Pro Enterprise.',
  workDayHours: 6,
  includeWeekends: false,
  defaultMarginPercent: 20,
  defaultRoleRates: {
    architect: 4800,
    engineer: 3500,
    analyst: 3000,
    consultant: 3800,
    developer: 3600,
    pm: 4000,
  },
  fields: [
    {
      label: 'Количество серверных платформ / нод ПАК (YADRO / Aquarius / Fplus)',
      key: 'servers_count',
      type: 'number',
      required: true,
      order: 0,
    },
    {
      label: 'Количество серверных стоек 42U/48U',
      key: 'racks_count',
      type: 'number',
      required: true,
      order: 1,
    },
    {
      label: 'Количество отказоустойчивых кластеров СУБД Postgres Pro',
      key: 'db_clusters_count',
      type: 'number',
      required: true,
      order: 2,
    },
    {
      label: 'Количество площадок / ЦОД для проведения ПНР',
      key: 'datacenter_count',
      type: 'number',
      required: true,
      order: 3,
    },
    {
      label: 'Сложность аппаратной архитектуры',
      key: 'complexity',
      type: 'complexity',
      required: true,
      order: 4,
    },
    {
      label: 'Требования к энергоснабжению, ИБП и кабельной инфраструктуре',
      key: 'comment',
      type: 'textarea',
      required: false,
      order: 5,
    },
  ],
  stageTemplates: [
    {
      name: 'Разработка Технического проекта, схем размещения и кабельного журнала',
      role: 'architect',
      baseHours: 32,
      hoursPerUnit: 4,
      driverFieldKey: 'servers_count',
      requirements:
        'Главный архитектор проекта (ГАП): расчет тепловыделения, энергопотребления, весовых нагрузок на фальшпол и схем коммутации SAN/LAN.',
      order: 0,
    },
    {
      name: 'Поставка серверов, СХД, коммутаторов и компонентов ПАК',
      role: 'engineer',
      baseHours: 16,
      hoursPerUnit: 2,
      driverFieldKey: 'servers_count',
      requirements:
        'Входной контроль оборудования, проверка комплектности, заводских номеров, сертификатов подлинности и гарантийных талонов.',
      order: 1,
    },
    {
      name: 'Монтаж в стойки 42U, кроссировка СКС и настройка IPMI/BMC/ИБП',
      role: 'engineer',
      baseHours: 20,
      hoursPerUnit: 8,
      driverFieldKey: 'racks_count',
      requirements:
        'Установка рельс, фиксация серверов и СХД, прокладка оптических и медных патч-кордов по кабельным органайзерам, настройка out-of-band управления IPMI/iDRAC.',
      order: 2,
    },
    {
      name: 'Установка, настройка и харденинг ОС Astra Linux Special Edition',
      role: 'engineer',
      baseHours: 16,
      hoursPerUnit: 3,
      driverFieldKey: 'servers_count',
      requirements:
        'Развертывание защищенного режима Смоленск/Воронеж, настройка мандатного контроля доступа (Parsec), синхронизации времени NTP и syslog.',
      order: 3,
    },
    {
      name: 'Развертывание и кластеризация СУБД Postgres Pro Enterprise (Patroni/Corosync)',
      role: 'engineer',
      baseHours: 24,
      hoursPerUnit: 18,
      driverFieldKey: 'db_clusters_count',
      requirements:
        'Настройка пула соединений PgBouncer, синхронной/асинхронной потоковой репликации, автоматического фейловера и оптимизации shared_buffers под All-Flash NVMe.',
      order: 4,
    },
    {
      name: 'Настройка резервного копирования Кибер Бэкап и проведение ПМИ ПАК',
      role: 'engineer',
      baseHours: 20,
      hoursPerUnit: 6,
      driverFieldKey: 'datacenter_count',
      requirements:
        'Настройка расписания полных и инкрементальных бэкапов, дедупликации, проверка восстановления базы и проведение приёмо-сдаточных испытаний ПАК по ПМИ.',
      order: 5,
    },
  ],
  riskTemplates: [
    {
      description:
        'Задержки логистики серверных платформ и комплектующих (коммутаторы, контроллеры RAID, трансиверы SFP+).',
      hours: 24,
      order: 0,
    },
    {
      description:
        'Неготовность инженерной инфраструктуры ЦОД Заказчика (электропитание, кондиционирование, доступы в машзал).',
      hours: 16,
      order: 1,
    },
    {
      description:
        'Специфические требования к согласованию регламентов ТО и сервисных контрактов вендора 24/7.',
      hours: 8,
      order: 2,
    },
  ],
};
