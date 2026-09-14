import { IndustryPreset } from '../types';

export const DATA_LAKE_BI_PLATFORM_PRESET: IndustryPreset = {
  id: 'preset-data-lake-bi-platform',
  name: 'Корпоративное хранилище данных и BI-аналитика (DWH / Data Lakehouse)',
  category: 'infrastructure',
  description:
    'Построение корпоративного хранилища данных: сбор из реляционных СУБД, файлов и очередей Kafka, многослойная архитектура (ODS/DDS/CDM), витрины на ClickHouse / Greenplum, интерактивные дашборды BI и Data Governance.',
  workDayHours: 6,
  includeWeekends: false,
  defaultMarginPercent: 22,
  defaultRoleRates: {
    architect: 4800,
    engineer: 3600,
    analyst: 3600,
    consultant: 3800,
    developer: 4000,
    pm: 4000,
  },
  fields: [
    {
      label: 'Количество подключаемых источников данных (БД, ERP, Clickstream, Kafka, файлы)',
      key: 'sources_count',
      type: 'number',
      required: true,
      order: 0,
    },
    {
      label: 'Плановый исходный объём данных в корпоративном хранилище (в терабайтах, ТБ)',
      key: 'data_volume_tb',
      type: 'number',
      required: true,
      order: 1,
    },
    {
      label: 'Количество аналитических предметных витрин данных (Data Marts)',
      key: 'data_marts_count',
      type: 'number',
      required: true,
      order: 2,
    },
    {
      label: 'Количество интерактивных аналитических дашбордов и управленческих отчётов',
      key: 'bi_dashboards_count',
      type: 'number',
      required: true,
      order: 3,
    },
    {
      label: 'Сложность алгоритмов трансформации данных и глубина очистки (Data Quality)',
      key: 'complexity',
      type: 'complexity',
      required: true,
      order: 4,
    },
    {
      label: 'Требования к каталогу данных (Data Catalog, Data Lineage) и SLA обновления витрин',
      key: 'comment',
      type: 'textarea',
      required: false,
      order: 5,
    },
  ],
  stageTemplates: [
    {
      name: 'Инвентаризация источников данных и разработка ТЗ по ГОСТ 34 на КХД/BI',
      role: 'analyst',
      baseHours: 32,
      hoursPerUnit: 4,
      driverFieldKey: 'sources_count',
      requirements:
        'Исполнитель обязан проанализировать структуру таблиц источников, составить карту потоков данных и спроектировать концептуальную и логическую модель КХД.',
      order: 0,
    },
    {
      name: 'Проектирование архитектуры Data Lakehouse, слоев ODS/DDS и витрин CDM',
      role: 'architect',
      baseHours: 30,
      hoursPerUnit: 5,
      driverFieldKey: 'data_marts_count',
      requirements:
        'Исполнитель обязан выбрать СУБД (ClickHouse/Greenplum/Postgres), выполнить её сайзинг и определить схемы шардирования, стратегии партиционирования и регламенты репликации.',
      order: 1,
    },
    {
      name: 'Разработка ETL/ELT конвейеров загрузки и инкрементальной синхронизации',
      role: 'developer',
      baseHours: 36,
      hoursPerUnit: 8,
      driverFieldKey: 'sources_count',
      requirements:
        'Исполнитель обязан разработать DAG-пайплайны Airflow, коннекторы CDC (Debezium), процедуры очистки, дедупликации и поддержки историчности (SCD 2).',
      order: 2,
    },
    {
      name: 'Построение аналитических витрин данных и внедрение каталога данных',
      role: 'developer',
      baseHours: 28,
      hoursPerUnit: 6,
      driverFieldKey: 'data_marts_count',
      requirements:
        'Исполнитель обязан оптимизировать проекции и агрегаты ClickHouse и задокументировать бизнес-термины и потоки трансформации в Data Lineage.',
      order: 3,
    },
    {
      name: 'Разработка дашбордов BI и настройка ролевой модели доступа к отчетам',
      role: 'developer',
      baseHours: 24,
      hoursPerUnit: 3,
      driverFieldKey: 'bi_dashboards_count',
      requirements:
        'Исполнитель обязан настроить графики, фильтры и срезы в аналитической BI-системе и обеспечить разграничение строк данных (RLS) по подразделениям.',
      order: 4,
    },
    {
      name: 'Нагрузочное тестирование на исторических срезах и сдача системы',
      role: 'engineer',
      baseHours: 20,
      hoursPerUnit: 0.5,
      driverFieldKey: 'data_volume_tb',
      requirements:
        'Исполнитель обязан проверить длительность ночного окна пересчёта витрин, протестировать отклик дашбордов при конкурентных запросах аналитиков и провести испытания по ПМИ.',
      order: 5,
    },
  ],
  riskTemplates: [
    {
      description:
        'Несоответствие форматов или нестабильность сетевых каналов до удаленных филиальных БД-источников.',
      hours: 20,
      order: 0,
    },
    {
      description:
        'Непредвиденный рост объёма «грязных» данных в источниках, требующий дополнительных алгоритмов очистки.',
      hours: 20,
      order: 1,
    },
    {
      description:
        'Длительное утверждение методик расчета аналитических KPI подразделениями бизнеса.',
      hours: 16,
      order: 2,
    },
  ],
};
