import type { SizingRules } from './types';

/**
 * Утверждённые v1-профили, воспроизводящие формулы пресейл-сайзинга
 * lib/presets/implementationSizing.ts (SIEM, IDM, NGFW).
 *
 * Отличие от пресейл-preview — семантика отсутствующих данных (#111): параметр без
 * ответа и без допущения остаётся неизвестным, и зависящая метрика = null
 * («невозможно рассчитать»), а не 0. Значения default — допущения профиля, они
 * попадают в список допущений прогона.
 *
 * Эти определения засеяны миграцией 20261030100000_sizing (JSON совпадает —
 * проверяется тестом builtin.test.ts). Изменения вносятся новой версией профиля
 * через UI/API, а не правкой этого файла.
 */
export interface BuiltinSizingProfile {
  key: string;
  name: string;
  domain: string;
  description: string;
  source: string;
  assumptions: string[];
  rules: SizingRules;
}

const SOURCE =
  'EvaCal: перенос формул пресейл-сайзинга lib/presets/implementationSizing.ts (v1, #101). Планировочная оценка, не вендорский BOM.';

export const BUILTIN_SIZING_PROFILES: BuiltinSizingProfile[] = [
  {
    key: 'siem',
    name: 'SIEM / SOC',
    domain: 'siem',
    description: 'Поток событий, хранение, коллекторы и ingest-ёмкость SIEM.',
    source: SOURCE,
    assumptions: [
      'Пиковый коэффициент EPS 2, размер события 800 байт, сжатие 2:1 — допущения до пилотной выборки.',
      'Запас хранения: 25% для оперативного и 15% для архивного уровня.',
      'Планировочный ingest-юнит — 5 000 EPS, коллектор — до 80 источников; это не вендорские лимиты.',
      'Сценарий роста использует допущение 30% роста потока и источников.',
    ],
    rules: {
      inputs: [
        {
          key: 'event_sources_count',
          label: 'Количество источников событий',
          type: 'number',
          unit: 'шт.',
          min: 0,
        },
        { key: 'eps_estimate', label: 'Средний поток EPS', type: 'number', unit: 'EPS', min: 0 },
        {
          key: 'eps_peak_factor',
          label: 'Коэффициент пика EPS',
          type: 'number',
          default: 2,
          min: 1,
        },
        {
          key: 'avg_event_size_bytes',
          label: 'Средний размер события',
          type: 'number',
          unit: 'байт',
          default: 800,
          min: 100,
        },
        {
          key: 'hot_retention_days',
          label: 'Срок оперативного хранения',
          type: 'number',
          unit: 'сут',
          default: 30,
          min: 1,
        },
        {
          key: 'archive_retention_days',
          label: 'Срок архивного хранения',
          type: 'number',
          unit: 'сут',
          default: 180,
          min: 0,
        },
        {
          key: 'compression_ratio',
          label: 'Коэффициент сжатия',
          type: 'number',
          default: 2,
          min: 1,
        },
        {
          key: 'sites_count',
          label: 'Количество площадок',
          type: 'number',
          unit: 'шт.',
          default: 1,
          min: 1,
        },
        {
          key: 'collector_ha_required',
          label: 'Резервирование коллекторов',
          type: 'boolean',
          default: true,
        },
        {
          key: 'platform_ha_required',
          label: 'Резервирование платформы',
          type: 'boolean',
          default: true,
        },
        {
          key: 'correlation_rules_count',
          label: 'Количество сценариев корреляции',
          type: 'number',
          unit: 'шт.',
          min: 0,
        },
        {
          key: 'siem_integrations_count',
          label: 'Количество внешних интеграций SIEM',
          type: 'number',
          unit: 'шт.',
          min: 0,
        },
        {
          key: 'growth_percent',
          label: 'Рост потока на горизонте планирования',
          type: 'number',
          unit: '%',
          default: 30,
          min: 0,
        },
      ],
      derived: [
        { key: 'peak_eps_raw', formula: 'eps_estimate * eps_peak_factor' },
        {
          key: 'daily_raw_gb',
          formula: 'eps_estimate * 86400 * avg_event_size_bytes / 1000000000',
        },
        {
          key: 'logical_collectors',
          formula:
            'max(sites_count, ceil(event_sources_count / 80), event_sources_count > 0 ? 1 : 0)',
        },
      ],
      outputs: [
        {
          key: 'peak_eps',
          label: 'Проектный peak EPS',
          kind: 'eps',
          unit: 'EPS',
          formula: 'peak_eps_raw',
          round: 'ceil',
          basis: 'avg EPS × коэффициент пика',
        },
        {
          key: 'daily_raw',
          label: 'Сырой поток в сутки',
          kind: 'disk',
          unit: 'ГБ/сут',
          formula: 'daily_raw_gb',
          round: 1,
          basis: 'EPS × 86400 × размер события',
        },
        {
          key: 'hot_storage',
          label: 'Оперативное хранение',
          kind: 'disk',
          unit: 'ТБ',
          formula: 'daily_raw_gb * hot_retention_days * 1.25 / compression_ratio / 1000',
          round: 2,
          basis: 'срок × поток, запас 25%, сжатие',
        },
        {
          key: 'archive_storage',
          label: 'Архивное хранение',
          kind: 'disk',
          unit: 'ТБ',
          formula: 'daily_raw_gb * archive_retention_days * 1.15 / compression_ratio / 1000',
          round: 2,
          basis: 'срок × поток, запас 15%, сжатие',
        },
        {
          key: 'collectors',
          label: 'Экземпляры коллекторов',
          kind: 'nodes',
          unit: 'шт.',
          formula: 'logical_collectors * (collector_ha_required ? 2 : 1)',
          basis: 'логические коллекторы × 2 при HA',
        },
        {
          key: 'ingest_units',
          label: 'Логические ingest-юниты',
          kind: 'nodes',
          unit: 'юн.',
          formula:
            'max(peak_eps_raw > 0 ? ceil(peak_eps_raw / 5000) : 1, platform_ha_required ? 2 : 1)',
          basis: 'планировочная единица 5k EPS; не вендорский BOM',
        },
        {
          key: 'use_cases',
          label: 'Сценарии корреляции',
          kind: 'count',
          unit: 'шт.',
          formula: 'correlation_rules_count',
          basis: 'из опросника',
        },
        {
          key: 'integrations',
          label: 'Внешние интеграции',
          kind: 'count',
          unit: 'шт.',
          formula: 'siem_integrations_count',
          basis: 'IRP/SOAR/TI/Service Desk и др.',
        },
      ],
      scenarios: [
        {
          key: 'ha',
          label: 'HA: резервирование включено',
          overrides: { collector_ha_required: 'true', platform_ha_required: 'true' },
        },
        {
          key: 'no_ha',
          label: 'Без резервирования',
          overrides: { collector_ha_required: 'false', platform_ha_required: 'false' },
        },
        {
          key: 'growth',
          label: 'Рост потока и источников',
          overrides: {
            eps_estimate: 'eps_estimate * (1 + growth_percent / 100)',
            event_sources_count: 'ceil(event_sources_count * (1 + growth_percent / 100))',
          },
        },
        {
          key: 'retention_x2',
          label: 'Удвоенный срок архивного хранения',
          overrides: { archive_retention_days: 'archive_retention_days * 2' },
        },
      ],
      tables: {},
    },
  },
  {
    key: 'idm',
    name: 'IDM / IGA',
    domain: 'idm',
    description: 'Прикладные узлы, connector workers, коннекторы и объём прав IDM/IGA.',
    source: SOURCE,
    assumptions: [
      'Среднее число назначений — 8 на идентичность, коэффициент пика JML — 3: допущения до выгрузки прав.',
      'Планировочные лимиты: 50 000 идентичностей или 20 целевых систем на прикладной узел; 10 систем или 3 000 пиковых JML в сутки на connector worker.',
      'Лицензионные единицы оценены по числу идентичностей; модель лицензирования конкретного вендора требует сверки.',
      'Сценарий роста использует допущение 20% роста числа идентичностей.',
    ],
    rules: {
      inputs: [
        {
          key: 'identities_count',
          label: 'Количество идентичностей',
          type: 'number',
          unit: 'шт.',
          min: 0,
        },
        {
          key: 'target_systems_count',
          label: 'Количество целевых систем',
          type: 'number',
          unit: 'шт.',
          min: 0,
        },
        {
          key: 'authoritative_sources_count',
          label: 'Количество авторитетных источников',
          type: 'number',
          unit: 'шт.',
          min: 0,
        },
        {
          key: 'avg_entitlements_per_identity',
          label: 'Среднее число назначений на идентичность',
          type: 'number',
          default: 8,
          min: 1,
        },
        { key: 'jml_events_per_day', label: 'Поток JML-событий в сутки', type: 'number', min: 0 },
        {
          key: 'jml_peak_factor',
          label: 'Коэффициент пика JML',
          type: 'number',
          default: 3,
          min: 1,
        },
        {
          key: 'recertification_required',
          label: 'Рекертификация прав',
          type: 'boolean',
          default: true,
        },
        {
          key: 'idm_ha_required',
          label: 'Резервирование IDM (HA)',
          type: 'boolean',
          default: true,
        },
        {
          key: 'growth_percent',
          label: 'Рост числа идентичностей',
          type: 'number',
          unit: '%',
          default: 20,
          min: 0,
        },
      ],
      derived: [
        { key: 'peak_jml_raw', formula: 'jml_events_per_day * jml_peak_factor' },
        { key: 'relations_raw', formula: 'identities_count * avg_entitlements_per_identity' },
      ],
      outputs: [
        {
          key: 'app_nodes',
          label: 'Прикладные узлы',
          kind: 'nodes',
          unit: 'шт.',
          formula:
            'max(idm_ha_required ? 2 : 1, ceil(identities_count / 50000), ceil(target_systems_count / 20))',
          basis: 'HA, 50k идентичностей/узел или 20 систем/узел',
        },
        {
          key: 'connector_workers',
          label: 'Логические connector workers',
          kind: 'nodes',
          unit: 'юн.',
          formula: 'max(1, ceil(target_systems_count / 10), ceil(peak_jml_raw / 3000))',
          basis: '10 систем/юнит или 3k peak JML/сутки',
        },
        {
          key: 'connectors',
          label: 'Интеграционные коннекторы',
          kind: 'count',
          unit: 'шт.',
          formula: 'target_systems_count + authoritative_sources_count',
          basis: 'мастер-источники + целевые системы',
        },
        {
          key: 'relations',
          label: 'Связи идентичность-полномочие',
          kind: 'count',
          unit: 'записей',
          formula: 'relations_raw',
          round: 'ceil',
          basis: 'идентичности × назначения',
        },
        {
          key: 'peak_jml',
          label: 'Пиковый JML-поток',
          kind: 'other',
          unit: 'событий/сут',
          formula: 'peak_jml_raw',
          round: 'ceil',
          basis: 'средний поток × коэффициент пика',
        },
        {
          key: 'recert_volume',
          label: 'Объём кампании рекертификации',
          kind: 'count',
          unit: 'решений',
          formula: 'recertification_required ? relations_raw : 0',
          round: 'ceil',
          basis: 'все назначения при включённой рекертификации',
        },
        {
          key: 'licensed_identities',
          label: 'Лицензионные единицы (идентичности)',
          kind: 'licenses',
          unit: 'ид.',
          formula: 'identities_count',
          basis: 'допущение: лицензирование по идентичностям',
        },
      ],
      scenarios: [
        { key: 'ha', label: 'HA: резервирование включено', overrides: { idm_ha_required: 'true' } },
        { key: 'no_ha', label: 'Без резервирования', overrides: { idm_ha_required: 'false' } },
        {
          key: 'growth',
          label: 'Рост числа идентичностей',
          overrides: { identities_count: 'ceil(identities_count * (1 + growth_percent / 100))' },
        },
      ],
      tables: {},
    },
  },
  {
    key: 'ngfw',
    name: 'NGFW',
    domain: 'ngfw',
    description: 'Узлы, целевая пропускная способность, TLS-inspection и VPN-нагрузка NGFW.',
    source: SOURCE,
    assumptions: [
      'Количество кластеров по умолчанию 1 и запас производительности 30% — допущения пресейла.',
      'Доля TLS-inspection без ответа неизвестна: TLS-метрика не рассчитывается.',
      'Пакет миграции — до 100 правил на контрольную волну.',
      'Сценарий роста использует допущение 50% роста трафика.',
    ],
    rules: {
      inputs: [
        {
          key: 'ngfw_clusters_count',
          label: 'Количество кластеров NGFW',
          type: 'number',
          unit: 'шт.',
          default: 1,
          min: 0,
        },
        {
          key: 'ngfw_ha_required',
          label: 'Резервирование NGFW (HA)',
          type: 'boolean',
          default: true,
        },
        {
          key: 'internet_throughput_gbps',
          label: 'Пропускная способность Internet',
          type: 'number',
          unit: 'Гбит/с',
          min: 0,
        },
        {
          key: 'east_west_throughput_gbps',
          label: 'Пропускная способность East-West',
          type: 'number',
          unit: 'Гбит/с',
          min: 0,
        },
        {
          key: 'capacity_headroom_percent',
          label: 'Запас производительности',
          type: 'number',
          unit: '%',
          default: 30,
          min: 0,
        },
        {
          key: 'tls_inspection_percent',
          label: 'Доля TLS-inspection',
          type: 'number',
          unit: '%',
          min: 0,
          max: 100,
        },
        {
          key: 'peak_concurrent_sessions',
          label: 'Пик одновременных сессий',
          type: 'number',
          min: 0,
        },
        {
          key: 'peak_new_connections_per_sec',
          label: 'Пик новых соединений в секунду',
          type: 'number',
          unit: 'CPS',
          min: 0,
        },
        { key: 'rules_count', label: 'Количество правил', type: 'number', unit: 'шт.', min: 0 },
        {
          key: 'network_zones_count',
          label: 'Количество сетевых зон',
          type: 'number',
          unit: 'шт.',
          min: 0,
        },
        {
          key: 'remote_vpn_users',
          label: 'Удалённые VPN-пользователи',
          type: 'number',
          unit: 'польз.',
          min: 0,
        },
        {
          key: 'site_to_site_vpn_count',
          label: 'Межплощадочные VPN-туннели',
          type: 'number',
          unit: 'шт.',
          min: 0,
        },
        {
          key: 'growth_percent',
          label: 'Рост трафика',
          type: 'number',
          unit: '%',
          default: 50,
          min: 0,
        },
      ],
      derived: [{ key: 'headroom_factor', formula: '1 + capacity_headroom_percent / 100' }],
      outputs: [
        {
          key: 'nodes',
          label: 'Узлы NGFW',
          kind: 'nodes',
          unit: 'шт.',
          formula: 'ngfw_clusters_count * (ngfw_ha_required ? 2 : 1)',
          basis: 'кластеры × 2 при HA',
        },
        {
          key: 'target_throughput',
          label: 'Target security throughput',
          kind: 'throughput',
          unit: 'Гбит/с',
          formula: '(internet_throughput_gbps + east_west_throughput_gbps) * headroom_factor',
          round: 2,
          basis: 'Internet + East-West + запас',
        },
        {
          key: 'tls_throughput',
          label: 'TLS inspection target',
          kind: 'throughput',
          unit: 'Гбит/с',
          formula: 'internet_throughput_gbps * tls_inspection_percent / 100 * headroom_factor',
          round: 2,
          basis: 'доля TLS интернет-трафика + запас',
        },
        {
          key: 'sessions',
          label: 'Пиковые сессии',
          kind: 'sessions',
          unit: 'сессий',
          formula: 'peak_concurrent_sessions',
          basis: 'из телеметрии/опросника',
        },
        {
          key: 'cps',
          label: 'Новые соединения',
          kind: 'sessions',
          unit: 'CPS',
          formula: 'peak_new_connections_per_sec',
          basis: 'пиковое значение',
        },
        {
          key: 'migration_batches',
          label: 'Пакеты миграции правил',
          kind: 'count',
          unit: 'пак.',
          formula: 'max(rules_count > 0 ? ceil(rules_count / 100) : 0, 1)',
          basis: 'до 100 правил/контрольную волну',
        },
        {
          key: 'zone_pairs',
          label: 'Потенциальные пары зон',
          kind: 'count',
          unit: 'пар',
          formula:
            'network_zones_count > 1 ? network_zones_count * (network_zones_count - 1) / 2 : 0',
          basis: 'верхняя оценка',
        },
        {
          key: 'vpn_users',
          label: 'VPN-пользователи (лицензии)',
          kind: 'licenses',
          unit: 'польз.',
          formula: 'remote_vpn_users',
          basis: 'из опросника',
        },
        {
          key: 'site_vpn',
          label: 'Межплощадочные VPN-туннели',
          kind: 'count',
          unit: 'шт.',
          formula: 'site_to_site_vpn_count',
          basis: 'из опросника',
        },
      ],
      scenarios: [
        {
          key: 'ha',
          label: 'HA: резервирование включено',
          overrides: { ngfw_ha_required: 'true' },
        },
        { key: 'no_ha', label: 'Без резервирования', overrides: { ngfw_ha_required: 'false' } },
        {
          key: 'growth',
          label: 'Рост трафика',
          overrides: {
            internet_throughput_gbps: 'internet_throughput_gbps * (1 + growth_percent / 100)',
            east_west_throughput_gbps: 'east_west_throughput_gbps * (1 + growth_percent / 100)',
          },
        },
      ],
      tables: {},
    },
  },
];
