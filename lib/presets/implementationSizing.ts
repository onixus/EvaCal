import type { Gost34RequirementItem, RequirementCategory } from '../gost34/types';

export type ImplementationSizingProfile = 'siem' | 'idm' | 'ngfw';

export interface SizingMetric {
  key: string;
  label: string;
  value: number | string;
  unit?: string;
  basis: string;
}

export interface TypicalTzSection {
  code: string;
  title: string;
  items: string[];
}

export interface TypicalPmiScenario {
  code: string;
  title: string;
  method: string;
  expectedResult: string;
}

export interface ImplementationSizing {
  profile: ImplementationSizingProfile;
  label: string;
  summary: string;
  metrics: SizingMetric[];
  warnings: string[];
  tzSections: TypicalTzSection[];
  pmiScenarios: TypicalPmiScenario[];
  gostRequirements: Gost34RequirementItem[];
}

function numberAnswer(answers: Record<string, unknown>, key: string, fallback = 0): number {
  const raw = answers[key];
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const parsed = Number(raw.replace(',', '.').trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function booleanAnswer(answers: Record<string, unknown>, key: string, fallback = false): boolean {
  const raw = answers[key];
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  if (typeof raw === 'string') {
    if (/^(true|1|да|yes|требуется)$/i.test(raw.trim())) return true;
    if (/^(false|0|нет|no|не требуется)$/i.test(raw.trim())) return false;
  }
  return fallback;
}

function textAnswer(answers: Record<string, unknown>, key: string, fallback = ''): string {
  const raw = answers[key];
  if (raw === null || raw === undefined) return fallback;
  const text = String(raw).trim();
  return text || fallback;
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function compact(value: number): string {
  if (value >= 1_000_000) return `${round(value / 1_000_000, 2)} млн`;
  if (value >= 1_000) return `${round(value / 1_000, 1)} тыс.`;
  return String(round(value, 1));
}

function requirement(
  id: string,
  code: string,
  category: RequirementCategory,
  title: string,
  description: string,
  criterion: string,
  stageName: string,
  stageRole: string,
): Gost34RequirementItem {
  return {
    id,
    code,
    category,
    title,
    description,
    criterion,
    stageName,
    stageRole,
    originalText: description,
    normalizedBy: 'evacal-presale-sizing',
  };
}

/**
 * Ключи-драйверы специализированных опросников внедрения — единственный
 * признак, по которому узнаётся профиль.
 *
 * Полный SIEM-профиль отличаем от прежнего короткого пресета по sizing-полям,
 * а выделенный NGFW — от комбинированного `preset-ngfw-szi` по сетевым
 * драйверам: `ngfw_clusters_count` есть в обоих. Это сохраняет
 * воспроизводимость старых расчётов — повторный экспорт legacy-пресета не
 * получает новые требования задним числом.
 */
const PROFILE_DRIVER_KEYS: ReadonlyArray<
  readonly [ImplementationSizingProfile, readonly string[]]
> = [
  [
    'siem',
    ['eps_peak_factor', 'avg_event_size_bytes', 'hot_retention_days', 'correlation_rules_count'],
  ],
  ['idm', ['identities_count', 'target_systems_count']],
  [
    'ngfw',
    ['rules_count', 'network_zones_count', 'internet_throughput_gbps', 'peak_concurrent_sessions'],
  ],
];

/**
 * Единственная точка распознавания профиля. И пресейл-sizing, и обогащение
 * ProjectContext ходят сюда: раньше у них были свои независимые эвристики,
 * которые расходились на смешанных анкетах.
 */
export function detectImplementationSizingProfileFromKeys(
  keys: Iterable<string>,
): ImplementationSizingProfile | null {
  const present = keys instanceof Set ? keys : new Set(keys);
  for (const [profile, drivers] of PROFILE_DRIVER_KEYS) {
    if (drivers.some((key) => present.has(key))) return profile;
  }
  return null;
}

/**
 * Профиль определяется только по ключам опросника — не по названию шаблона.
 * Название совпадает у полного и у прежнего короткого пресета, и распознавание
 * по нему добавляло бы новые требования в уже выпущенные комплекты.
 */
export function detectImplementationSizingProfile(
  answers: Record<string, unknown>,
  fieldKeys: string[] = [],
): ImplementationSizingProfile | null {
  return detectImplementationSizingProfileFromKeys([...Object.keys(answers), ...fieldKeys]);
}

export function buildImplementationSizing(
  answers: Record<string, unknown>,
  fieldKeys: string[] = [],
): ImplementationSizing | null {
  const profile = detectImplementationSizingProfile(answers, fieldKeys);
  if (!profile) return null;

  if (profile === 'siem') return buildSiemSizing(answers);
  if (profile === 'idm') return buildIdmSizing(answers);
  return buildNgfwSizing(answers);
}

function buildSiemSizing(answers: Record<string, unknown>): ImplementationSizing {
  const sources = Math.max(0, numberAnswer(answers, 'event_sources_count'));
  const avgEps = Math.max(0, numberAnswer(answers, 'eps_estimate'));
  const peakFactor = Math.max(1, numberAnswer(answers, 'eps_peak_factor', 2));
  const peakEps = avgEps * peakFactor;
  const eventSizeBytes = Math.max(100, numberAnswer(answers, 'avg_event_size_bytes', 800));
  const hotDays = Math.max(1, numberAnswer(answers, 'hot_retention_days', 30));
  const archiveDays = Math.max(0, numberAnswer(answers, 'archive_retention_days', 180));
  const compressionRatio = Math.max(1, numberAnswer(answers, 'compression_ratio', 2));
  const sites = Math.max(1, numberAnswer(answers, 'sites_count', 1));
  const collectorHa = booleanAnswer(answers, 'collector_ha_required', true);
  const platformHa = booleanAnswer(answers, 'platform_ha_required', true);
  const useCases = Math.max(0, numberAnswer(answers, 'correlation_rules_count'));
  const customConnectors = Math.max(0, numberAnswer(answers, 'custom_connectors_count'));
  const integrations = Math.max(0, numberAnswer(answers, 'siem_integrations_count'));
  const gossopka = booleanAnswer(answers, 'gossopka_required');
  const sla = Math.max(0, numberAnswer(answers, 'availability_target_percent', 99.9));

  const dailyRawGb = (avgEps * 86_400 * eventSizeBytes) / 1_000_000_000;
  const hotStorageTb = (dailyRawGb * hotDays * 1.25) / compressionRatio / 1_000;
  const archiveStorageTb = (dailyRawGb * archiveDays * 1.15) / compressionRatio / 1_000;
  const logicalCollectors = Math.max(sites, Math.ceil(sources / 80), sources > 0 ? 1 : 0);
  const collectorInstances = logicalCollectors * (collectorHa ? 2 : 1);
  const ingestUnits = Math.max(peakEps > 0 ? Math.ceil(peakEps / 5_000) : 1, platformHa ? 2 : 1);

  const warnings: string[] = [];
  if (avgEps <= 0)
    warnings.push('Не задан средний EPS: расчёт хранилища и ingest-ёмкости предварительный.');
  if (!answers.avg_event_size_bytes)
    warnings.push('Размер события принят 800 байт. Уточните по пилотной выборке логов.');
  if (!answers.compression_ratio)
    warnings.push(
      'Коэффициент сжатия принят 2:1. Фактическое значение зависит от формата событий и платформы.',
    );
  if (customConnectors > 0)
    warnings.push(
      `Нестандартных коннекторов: ${customConnectors}. Для них требуется отдельная оценка парсеров и тестовых данных.`,
    );

  const peakCriterion =
    peakEps > 0
      ? `При тестовой нагрузке ${Math.ceil(peakEps)} EPS события принимаются и индексируются без подтверждённой потери в контрольной выборке.`
      : 'При согласованной пиковой нагрузке события принимаются и индексируются без подтверждённой потери в контрольной выборке.';

  const requirements: Gost34RequirementItem[] = [
    requirement(
      'preset-siem-req-performance',
      'ТР-SIEM-01',
      'performance',
      'Производительность приема событий',
      `SIEM должна устойчиво обрабатывать средний поток ${Math.ceil(avgEps)} EPS и проектный пиковый поток ${Math.ceil(peakEps)} EPS с возможностью горизонтального масштабирования ingest-слоя.`,
      peakCriterion,
      'Развертывание и сайзинг платформы SIEM',
      'engineer',
    ),
    requirement(
      'preset-siem-req-retention',
      'ТР-SIEM-02',
      'technical',
      'Хранение и ретенция событий',
      `Система должна обеспечивать оперативное хранение событий не менее ${hotDays} суток и архивное хранение не менее ${archiveDays} суток. Проектная оценка полезной емкости: ${round(hotStorageTb, 2)} ТБ hot + ${round(archiveStorageTb, 2)} ТБ archive без учета резервных копий платформы.`,
      `В тестовом контуре подтверждены политики ретенции ${hotDays}/${archiveDays} суток, поиск доступен по событиям в пределах настроенных уровней хранения.`,
      'Развертывание и сайзинг платформы SIEM',
      'engineer',
    ),
    requirement(
      'preset-siem-req-sources',
      'ТР-SIEM-03',
      'integration',
      'Подключение источников событий',
      `Должно быть подключено до ${sources} источников событий с контролем полноты доставки, нормализацией полей и диагностикой разрыва потока. Нестандартных коннекторов: ${customConnectors}.`,
      `Все согласованные источники передают тестовые события, события нормализованы, время последнего приема и ошибки подключения доступны оператору.`,
      'Подключение и нормализация источников событий',
      'engineer',
    ),
    requirement(
      'preset-siem-req-correlation',
      'ТР-SIEM-04',
      'functional',
      'Сценарии выявления инцидентов',
      `SIEM должна реализовать не менее ${useCases} согласованных правил/сценариев корреляции с приоритизацией, контекстом актива и передачей результата в процессы реагирования.`,
      `Для каждого согласованного use case выполнен позитивный тест с формированием инцидента и негативный тест на отсутствие заведомо ложного срабатывания.`,
      'Разработка и тюнинг сценариев корреляции',
      'analyst',
    ),
    requirement(
      'preset-siem-req-ha',
      'ТР-SIEM-05',
      'reliability',
      'Отказоустойчивость SIEM',
      `Целевая доступность платформы: ${sla}%. Критические компоненты сбора и обработки событий должны исключать единую точку отказа; проект предусматривает ${collectorInstances} экземпляров коллекторов и не менее ${ingestUnits} логических ingest-юнитов.`,
      'При имитации отказа одного критического компонента прием событий продолжается либо автоматически восстанавливается в пределах согласованного эксплуатационного окна без нарушения целостности контрольной выборки.',
      'Развертывание и сайзинг платформы SIEM',
      'engineer',
    ),
    requirement(
      'preset-siem-req-audit',
      'ТР-SIEM-06',
      'security',
      'Разграничение доступа и аудит',
      'Административный и аналитический доступ к SIEM должен предоставляться по ролям; действия администраторов, изменение правил корреляции и политик хранения должны регистрироваться в аудите.',
      'Проверены роли оператора, аналитика и администратора; неразрешенные действия отклоняются, разрешенные административные изменения отражаются в журнале аудита.',
      'Опытная эксплуатация, обучение SOC и приемочные испытания',
      'analyst',
    ),
  ];

  if (gossopka) {
    requirements.push(
      requirement(
        'preset-siem-req-gossopka',
        'ТР-SIEM-07',
        'integration',
        'Взаимодействие с ГосСОПКА',
        'При подтвержденной применимости должно быть реализовано согласованное информационное взаимодействие с технической инфраструктурой ГосСОПКА/НКЦКИ в пределах роли Заказчика и утвержденного регламента.',
        'На тестовом сценарии формируется требуемый набор сведений об инциденте и подтверждается прохождение согласованного канала взаимодействия без раскрытия продуктивных секретов.',
        'Регламенты реагирования и внешние интеграции',
        'consultant',
      ),
    );
  }

  return {
    profile: 'siem',
    label: 'SIEM / SOC',
    summary: `Проектный профиль: ${compact(peakEps)} EPS peak, ${sources} источников, ${round(hotStorageTb + archiveStorageTb, 2)} ТБ расчетного хранения.`,
    metrics: [
      {
        key: 'peak_eps',
        label: 'Проектный peak EPS',
        value: Math.ceil(peakEps),
        unit: 'EPS',
        basis: `avg EPS × ${peakFactor}`,
      },
      {
        key: 'daily_raw',
        label: 'Сырой поток в сутки',
        value: round(dailyRawGb, 1),
        unit: 'ГБ/сут',
        basis: `${eventSizeBytes} байт/событие`,
      },
      {
        key: 'hot_storage',
        label: 'Оперативное хранение',
        value: round(hotStorageTb, 2),
        unit: 'ТБ',
        basis: `${hotDays} суток, запас 25%, сжатие ${compressionRatio}:1`,
      },
      {
        key: 'archive_storage',
        label: 'Архивное хранение',
        value: round(archiveStorageTb, 2),
        unit: 'ТБ',
        basis: `${archiveDays} суток, запас 15%`,
      },
      {
        key: 'collectors',
        label: 'Экземпляры коллекторов',
        value: collectorInstances,
        unit: 'шт.',
        basis: `${logicalCollectors} логических × ${collectorHa ? '2 (HA)' : '1'}`,
      },
      {
        key: 'ingest_units',
        label: 'Логические ingest-юниты',
        value: ingestUnits,
        unit: 'юн.',
        basis: 'планировочная единица 5k EPS; не вендорский BOM',
      },
      {
        key: 'use_cases',
        label: 'Сценарии корреляции',
        value: useCases,
        unit: 'шт.',
        basis: 'из пресейл-опросника',
      },
      {
        key: 'integrations',
        label: 'Внешние интеграции',
        value: integrations,
        unit: 'шт.',
        basis: 'IRP/SOAR/TI/Service Desk и др.',
      },
    ],
    warnings,
    tzSections: [
      {
        code: '4.1.1',
        title: 'Надежность и доступность',
        items: [
          'HA критических компонентов',
          `целевая доступность ${sla}%`,
          'контроль очередей и восстановления приема',
        ],
      },
      {
        code: '4.1.2',
        title: 'Защита информации',
        items: [
          'RBAC операторов/аналитиков/администраторов',
          'аудит административных изменений',
          'защищенное взаимодействие компонентов',
        ],
      },
      {
        code: '4.1.4',
        title: 'Производительность',
        items: [
          `средний поток ${Math.ceil(avgEps)} EPS`,
          `пиковый поток ${Math.ceil(peakEps)} EPS`,
          'масштабирование ingest и хранения',
        ],
      },
      {
        code: '4.1.6',
        title: 'Интеграции',
        items: [
          `${sources} источников событий`,
          `${customConnectors} нестандартных коннекторов`,
          `${integrations} внешних интеграций`,
        ],
      },
      {
        code: '4.2.1',
        title: 'Функции мониторинга',
        items: [
          `${useCases} use cases`,
          'нормализация и категоризация',
          'контроль полноты логирования',
        ],
      },
    ],
    pmiScenarios: [
      {
        code: 'ПМИ-SIEM-01',
        title: 'Нагрузочный прием событий',
        method: `Генерация потока до ${Math.ceil(peakEps)} EPS с контрольной выборкой событий.`,
        expectedResult: peakCriterion,
      },
      {
        code: 'ПМИ-SIEM-02',
        title: 'Подключение источников',
        method:
          'Генерация характерных тестовых событий на согласованных источниках и проверка нормализации.',
        expectedResult:
          'События поступают, нормализуются и доступны для поиска; разрыв потока диагностируется.',
      },
      {
        code: 'ПМИ-SIEM-03',
        title: 'Корреляция',
        method: 'Воспроизведение позитивных и негативных сценариев для согласованных use cases.',
        expectedResult:
          'Позитивные сценарии создают инциденты, отрицательные не формируют заведомо ложный результат.',
      },
      {
        code: 'ПМИ-SIEM-04',
        title: 'Отказоустойчивость',
        method: 'Отключение одного критического компонента/коллектора в тестовом контуре.',
        expectedResult:
          'Прием и обработка событий продолжаются или восстанавливаются в согласованное время без нарушения контрольной выборки.',
      },
    ],
    gostRequirements: requirements,
  };
}

function buildIdmSizing(answers: Record<string, unknown>): ImplementationSizing {
  const identities = Math.max(0, numberAnswer(answers, 'identities_count'));
  const targetSystems = Math.max(0, numberAnswer(answers, 'target_systems_count'));
  const sources = Math.max(0, numberAnswer(answers, 'authoritative_sources_count'));
  const roles = Math.max(0, numberAnswer(answers, 'business_roles_count'));
  const avgEntitlements = Math.max(1, numberAnswer(answers, 'avg_entitlements_per_identity', 8));
  const jmlPerDay = Math.max(0, numberAnswer(answers, 'jml_events_per_day'));
  const peakFactor = Math.max(1, numberAnswer(answers, 'jml_peak_factor', 3));
  const peakJml = jmlPerDay * peakFactor;
  const approvalFlows = Math.max(0, numberAnswer(answers, 'approval_workflows_count'));
  const serviceAccounts = Math.max(0, numberAnswer(answers, 'service_accounts_count'));
  const recertification = booleanAnswer(answers, 'recertification_required', true);
  const recertificationPeriod = textAnswer(answers, 'recertification_period', 'Ежеквартально');
  const sod = booleanAnswer(answers, 'sod_required', true);
  const pam = booleanAnswer(answers, 'pam_integration_required');
  const ha = booleanAnswer(answers, 'idm_ha_required', true);
  const provisionSla = Math.max(1, numberAnswer(answers, 'provisioning_sla_minutes', 30));
  const availability = Math.max(0, numberAnswer(answers, 'availability_target_percent', 99.9));

  const appNodes = Math.max(
    ha ? 2 : 1,
    Math.ceil(identities / 50_000),
    Math.ceil(targetSystems / 20),
  );
  const connectorWorkers = Math.max(1, Math.ceil(targetSystems / 10), Math.ceil(peakJml / 3_000));
  const relations = identities * avgEntitlements;
  const connectors = targetSystems + sources;
  const campaignVolume = recertification ? relations : 0;

  const warnings: string[] = [];
  if (identities <= 0)
    warnings.push('Не задано количество идентичностей: нагрузочные оценки IDM предварительные.');
  if (targetSystems <= 0)
    warnings.push(
      'Не задан перечень/количество целевых систем: интеграционный контур не может быть оценен полностью.',
    );
  if (!answers.avg_entitlements_per_identity)
    warnings.push(
      'Среднее число назначений принято равным 8 на идентичность; уточните по выгрузке текущих прав.',
    );
  if (pam)
    warnings.push(
      'PAM-интеграция оценивается как отдельный интерфейс; состав привилегированных сценариев требуется уточнить на обследовании.',
    );

  const requirements: Gost34RequirementItem[] = [
    requirement(
      'preset-idm-req-jml',
      'ТР-IDM-01',
      'functional',
      'Жизненный цикл идентичностей Joiner/Mover/Leaver',
      `IDM должна автоматически обрабатывать события приема, перевода и увольнения из авторитетных источников. Расчетный средний поток: ${jmlPerDay} JML-событий/сутки, пиковый: ${Math.ceil(peakJml)}.`,
      `Для тестовых Joiner/Mover/Leaver-событий целевое состояние учетных записей достигается не позднее ${provisionSla} минут после получения корректного исходного события, за исключением систем с согласованным ручным исполнением.`,
      'Настройка JML, заявок и ролевой модели',
      'consultant',
    ),
    requirement(
      'preset-idm-req-connectors',
      'ТР-IDM-02',
      'integration',
      'Интеграция с мастер- и целевыми системами',
      `Должны быть реализованы интеграции с ${sources} авторитетными источниками и ${targetSystems} целевыми системами, включая сверку, провижининг, блокировку и обработку ошибок.`,
      'На каждой согласованной интеграции выполнены чтение, создание/изменение и отзыв тестового назначения либо документирована ограниченная модель интеграции.',
      'Интеграция мастер-систем и целевых информационных систем',
      'developer',
    ),
    requirement(
      'preset-idm-req-rbac',
      'ТР-IDM-03',
      'security',
      'Ролевая модель и контроль конфликтов полномочий',
      `Система должна поддерживать централизованную модель минимум из ${roles} бизнес-ролей, назначение владельцев ресурсов и ${sod ? 'контроль конфликтов SoD' : 'возможность последующего включения контроля SoD'}.`,
      sod
        ? 'Тестовая конфликтующая комбинация полномочий выявляется и блокируется/маркируется согласно согласованной политике SoD.'
        : 'Назначения ролей соответствуют утвержденной матрице полномочий и фиксируются в аудите.',
      'Проектирование архитектуры IDM / IGA и модели ролей',
      'architect',
    ),
    requirement(
      'preset-idm-req-recert',
      'ТР-IDM-04',
      'functional',
      'Рекертификация прав доступа',
      recertification
        ? `IDM должна поддерживать кампании пересмотра прав доступа с расчетным объемом до ${compact(campaignVolume)} назначений за кампанию. Периодичность: ${recertificationPeriod}.`
        : 'Архитектура должна допускать включение периодической рекертификации прав без замены интеграционного слоя.',
      recertification
        ? 'Создана тестовая кампания, назначения распределены владельцам на подтверждение/отзыв, результаты решений отражены в аудите и отчетности.'
        : 'Функция рекертификации доступна для последующей настройки либо ограничение явно зафиксировано в проектной документации.',
      'Настройка JML, заявок и ролевой модели',
      'consultant',
    ),
    requirement(
      'preset-idm-req-performance',
      'ТР-IDM-05',
      'performance',
      'Производительность IDM',
      `Проектная емкость должна учитывать ${identities} идентичностей, около ${compact(relations)} связей «идентичность-полномочие» и пиковый поток ${Math.ceil(peakJml)} JML-событий/сутки.`,
      `Контрольная пакетная сверка выполняется для тестовой выборки без потери данных, а одиночное JML-событие укладывается в SLA ${provisionSla} минут при штатной доступности целевой системы.`,
      'Развертывание платформы IDM / IGA и базовая конфигурация',
      'engineer',
    ),
    requirement(
      'preset-idm-req-ha',
      'ТР-IDM-06',
      'reliability',
      'Доступность и восстановление IDM',
      `Целевая доступность: ${availability}%. Проект предусматривает не менее ${appNodes} прикладных узлов/экземпляров при включенном HA и резервирование критичных данных конфигурации.`,
      'При отказе одного прикладного узла пользовательские и фоновые операции продолжаются либо восстанавливаются автоматически без потери подтвержденных заявок.',
      'Развертывание платформы IDM / IGA и базовая конфигурация',
      'engineer',
    ),
    requirement(
      'preset-idm-req-audit',
      'ТР-IDM-07',
      'security',
      'Аудит операций управления доступом',
      `Необходимо регистрировать создание/изменение/блокировку учетных записей, решения по заявкам и рекертификации, изменение ролей и административные действия. Сервисных учетных записей в контуре: ${serviceAccounts}.`,
      'Для контрольной выборки операций в аудите присутствуют инициатор, объект доступа, действие, результат и время; журнал недоступен для неразрешенного изменения обычным оператором.',
      'Миграция, опытная эксплуатация, обучение и ПМИ',
      'analyst',
    ),
  ];

  if (pam) {
    requirements.push(
      requirement(
        'preset-idm-req-pam',
        'ТР-IDM-08',
        'integration',
        'Интеграция IDM с PAM',
        'Для привилегированных учетных записей должна быть предусмотрена интеграция IDM/IGA с PAM: инициирование жизненного цикла, передача контекста владельца/роли и согласованная сверка состояния.',
        'Для тестовой привилегированной учетной записи подтверждается согласованный сквозной сценарий IDM → PAM → отзыв/сверка без передачи секретов в журналы IDM.',
        'Интеграция мастер-систем и целевых информационных систем',
        'developer',
      ),
    );
  }

  return {
    profile: 'idm',
    label: 'IDM / IGA',
    summary: `Проектный профиль: ${compact(identities)} идентичностей, ${targetSystems} целевых систем, ${compact(relations)} связей прав.`,
    metrics: [
      {
        key: 'app_nodes',
        label: 'Прикладные узлы',
        value: appNodes,
        unit: 'шт.',
        basis: `${ha ? 'HA, ' : ''}50k идентичностей/узел или 20 систем/узел`,
      },
      {
        key: 'connector_workers',
        label: 'Логические connector workers',
        value: connectorWorkers,
        unit: 'юн.',
        basis: '10 систем/юнит или 3k peak JML/сутки',
      },
      {
        key: 'connectors',
        label: 'Интеграционные коннекторы',
        value: connectors,
        unit: 'шт.',
        basis: 'мастер-источники + целевые системы',
      },
      {
        key: 'relations',
        label: 'Связи идентичность-полномочие',
        value: compact(relations),
        unit: 'записей',
        basis: `${avgEntitlements} назначений/идентичность`,
      },
      {
        key: 'peak_jml',
        label: 'Пиковый JML-поток',
        value: Math.ceil(peakJml),
        unit: 'событий/сут',
        basis: `средний поток × ${peakFactor}`,
      },
      {
        key: 'roles',
        label: 'Бизнес-роли',
        value: roles,
        unit: 'шт.',
        basis: 'из пресейл-опросника',
      },
      {
        key: 'workflows',
        label: 'Маршруты согласования',
        value: approvalFlows,
        unit: 'шт.',
        basis: 'из пресейл-опросника',
      },
      {
        key: 'recert_volume',
        label: 'Объем кампании рекертификации',
        value: recertification ? compact(campaignVolume) : 'не включено',
        unit: recertification ? 'решений' : undefined,
        basis: recertificationPeriod,
      },
    ],
    warnings,
    tzSections: [
      {
        code: '4.1.1',
        title: 'Надежность',
        items: [
          `доступность ${availability}%`,
          `${appNodes} прикладных узлов`,
          'резервирование конфигурации и очередей',
        ],
      },
      {
        code: '4.1.2',
        title: 'Защита информации',
        items: [
          `${roles} бизнес-ролей`,
          sod ? 'SoD включен' : 'SoD опционален',
          'аудит всех решений по доступу',
        ],
      },
      {
        code: '4.1.4',
        title: 'Производительность',
        items: [
          `${identities} идентичностей`,
          `${Math.ceil(peakJml)} peak JML/сутки`,
          `SLA провижининга ${provisionSla} мин`,
        ],
      },
      {
        code: '4.1.6',
        title: 'Интеграции',
        items: [
          `${sources} мастер-источников`,
          `${targetSystems} целевых систем`,
          pam ? 'интеграция с PAM' : 'PAM не заявлен',
        ],
      },
      {
        code: '4.2.1',
        title: 'Функции IDM/IGA',
        items: [
          'Joiner/Mover/Leaver',
          'заявки и согласования',
          recertification
            ? `рекертификация: ${recertificationPeriod}`
            : 'рекертификация не включена',
        ],
      },
    ],
    pmiScenarios: [
      {
        code: 'ПМИ-IDM-01',
        title: 'Joiner/Mover/Leaver',
        method:
          'Создание тестовых кадровых событий приема, перевода и увольнения с фиксацией времени.',
        expectedResult: `Целевое состояние достигается в пределах ${provisionSla} минут для автоматизированных интеграций.`,
      },
      {
        code: 'ПМИ-IDM-02',
        title: 'Провижининг и отзыв доступа',
        method: 'Создание заявки, прохождение маршрута согласования и отзыв тестового назначения.',
        expectedResult: 'Состояние целевой учетной записи и аудит соответствуют принятому решению.',
      },
      {
        code: 'ПМИ-IDM-03',
        title: 'RBAC / SoD',
        method: 'Назначение разрешенной и конфликтующей комбинации ролей.',
        expectedResult: sod
          ? 'Конфликт SoD выявляется и обрабатывается по политике.'
          : 'Назначения соответствуют утвержденной матрице ролей.',
      },
      {
        code: 'ПМИ-IDM-04',
        title: 'Рекертификация',
        method: 'Запуск тестовой кампании на контрольной группе пользователей.',
        expectedResult: recertification
          ? 'Решения владельцев ресурсов фиксируются и применяются к назначениям.'
          : 'Функция доступна для последующего включения или исключение документировано.',
      },
    ],
    gostRequirements: requirements,
  };
}

function buildNgfwSizing(answers: Record<string, unknown>): ImplementationSizing {
  const clusters = Math.max(1, numberAnswer(answers, 'ngfw_clusters_count', 1));
  const zones = Math.max(0, numberAnswer(answers, 'network_zones_count'));
  const rules = Math.max(0, numberAnswer(answers, 'rules_count'));
  const integrations = Math.max(0, numberAnswer(answers, 'integrations_count'));
  const internetGbps = Math.max(0, numberAnswer(answers, 'internet_throughput_gbps'));
  const eastWestGbps = Math.max(0, numberAnswer(answers, 'east_west_throughput_gbps'));
  const headroom = Math.max(0, numberAnswer(answers, 'capacity_headroom_percent', 30));
  const tlsPercent = Math.min(100, Math.max(0, numberAnswer(answers, 'tls_inspection_percent')));
  const concurrentSessions = Math.max(0, numberAnswer(answers, 'peak_concurrent_sessions'));
  const cps = Math.max(0, numberAnswer(answers, 'peak_new_connections_per_sec'));
  const vpnUsers = Math.max(0, numberAnswer(answers, 'remote_vpn_users'));
  const siteVpn = Math.max(0, numberAnswer(answers, 'site_to_site_vpn_count'));
  const ha = booleanAnswer(answers, 'ngfw_ha_required', true);
  const ips = booleanAnswer(answers, 'ips_required', true);
  const siem = booleanAnswer(answers, 'siem_integration_required', true);
  const availability = Math.max(0, numberAnswer(answers, 'availability_target_percent', 99.99));
  const changeWindow = textAnswer(answers, 'cutover_window', 'по согласованному окну');

  const baseTraffic = internetGbps + eastWestGbps;
  const targetSecurityThroughput = baseTraffic * (1 + headroom / 100);
  const tlsThroughput = internetGbps * (tlsPercent / 100) * (1 + headroom / 100);
  const applianceNodes = clusters * (ha ? 2 : 1);
  const migrationBatches = Math.max(rules > 0 ? Math.ceil(rules / 100) : 0, 1);
  const zonePairs = zones > 1 ? (zones * (zones - 1)) / 2 : 0;

  const warnings: string[] = [];
  if (baseTraffic <= 0)
    warnings.push(
      'Не задана пропускная способность: аппаратный класс NGFW нельзя выбрать по производительности.',
    );
  if (concurrentSessions <= 0)
    warnings.push(
      'Не задан пик одновременных сессий: проверьте лимит session table по статистике действующих шлюзов.',
    );
  if (cps <= 0)
    warnings.push(
      'Не задан пик новых соединений/с: CPS необходимо снять с действующего периметра или пилота.',
    );
  if (tlsPercent > 0)
    warnings.push(
      'TLS inspection требует отдельной проверки производительности на выбранном наборе шифров и исключений certificate pinning.',
    );

  const performanceCriterion =
    targetSecurityThroughput > 0
      ? `При профиле не ниже ${round(targetSecurityThroughput, 2)} Гбит/с через включенные согласованные функции безопасности загрузка не приводит к потере доступности контрольных сервисов и превышению согласованных порогов ресурсов.`
      : 'При согласованном нагрузочном профиле включение функций безопасности не приводит к потере доступности контрольных сервисов.';

  const requirements: Gost34RequirementItem[] = [
    requirement(
      'preset-ngfw-req-performance',
      'ТР-NGFW-01',
      'performance',
      'Производительность NGFW',
      `Выбранный класс NGFW должен обеспечивать проектную пропускную способность не ниже ${round(targetSecurityThroughput, 2)} Гбит/с с запасом ${headroom}% при включенном наборе согласованных функций безопасности. Требование к TLS-inspection: до ${round(tlsThroughput, 2)} Гбит/с.`,
      performanceCriterion,
      'Развертывание и кластеризация NGFW',
      'engineer',
    ),
    requirement(
      'preset-ngfw-req-ha',
      'ТР-NGFW-02',
      'reliability',
      'Отказоустойчивость межсетевого экранирования',
      `Проект предусматривает ${clusters} кластер(а/ов), всего ${applianceNodes} узлов. Целевая доступность: ${availability}%. Состояние сессий и критичные объекты политики должны синхронизироваться в пределах возможностей выбранной платформы.`,
      'При отказе активного узла трафик контрольных сервисов восстанавливается на резервном узле в согласованный норматив; правила и маршрутизация соответствуют эталонной конфигурации.',
      'Развертывание и кластеризация NGFW',
      'engineer',
    ),
    requirement(
      'preset-ngfw-req-policy',
      'ТР-NGFW-03',
      'security',
      'Политика межсетевого экранирования',
      `Должна быть реализована и документирована матрица взаимодействий для ${zones} сетевых зон. Миграции и ревизии подлежат около ${rules} правил; принцип по умолчанию — запрет неразрешенных взаимодействий.`,
      'Набор разрешенных контрольных потоков проходит, запрещенные контрольные потоки блокируются и регистрируются; отсутствуют неутвержденные any-any правила.',
      'Миграция и оптимизация правил межсетевого экранирования',
      'engineer',
    ),
    requirement(
      'preset-ngfw-req-security-services',
      'ТР-NGFW-04',
      'security',
      'Сервисы безопасности NGFW',
      `Требуется настройка ${ips ? 'IPS' : 'базового межсетевого экранирования'} и TLS-inspection для ${tlsPercent}% применимого интернет-трафика с перечнем исключений. Политики должны быть привязаны к зонам, сервисам и владельцам.`,
      'Тестовая сигнатура/сценарий IPS обрабатывается согласно политике; TLS-inspection применяется только к согласованным категориям, исключения не нарушают критичные приложения.',
      'Настройка сервисов безопасности и внешних интеграций',
      'engineer',
    ),
    requirement(
      'preset-ngfw-req-integration',
      'ТР-NGFW-05',
      'integration',
      'Инфраструктурные интеграции NGFW',
      `Необходимо реализовать ${integrations} внешних интеграций с каталогами, DNS/NTP, PKI, системами управления и ${siem ? 'SIEM' : 'журналированием по согласованному назначению'}.`,
      'Каждая согласованная интеграция проходит позитивную проверку, ошибки взаимодействия диагностируются и не приводят к неконтролируемому ослаблению политики безопасности.',
      'Настройка сервисов безопасности и внешних интеграций',
      'engineer',
    ),
    requirement(
      'preset-ngfw-req-vpn',
      'ТР-NGFW-06',
      'functional',
      'VPN-доступ и межплощадочные туннели',
      `Проект должен учитывать до ${vpnUsers} одновременных удаленных VPN-пользователей и ${siteVpn} межплощадочных VPN-туннелей, если соответствующие функции входят в объем проекта.`,
      'Контрольный удаленный пользователь и тестовый межплощадочный туннель устанавливаются, получают только разрешенные маршруты и корректно закрываются с регистрацией события.',
      'Настройка сервисов безопасности и внешних интеграций',
      'engineer',
    ),
    requirement(
      'preset-ngfw-req-cutover',
      'ТР-NGFW-07',
      'testing_acceptance',
      'Переключение и план возврата',
      `Промышленное переключение выполняется ${changeWindow}. До переключения должен быть проверен план возврата к исходной схеме и перечень контрольных бизнес-сервисов.`,
      'На тестовом или согласованном промышленном окне выполнены проверки контрольных сервисов, HA и сценария rollback; результаты зафиксированы в протоколе.',
      'Опытная эксплуатация, переключение, обучение и ПМИ',
      'consultant',
    ),
  ];

  return {
    profile: 'ngfw',
    label: 'NGFW',
    summary: `Проектный профиль: ${clusters} кластер(а/ов), ${round(targetSecurityThroughput, 2)} Гбит/с target security throughput, ${rules} правил миграции.`,
    metrics: [
      {
        key: 'nodes',
        label: 'Узлы NGFW',
        value: applianceNodes,
        unit: 'шт.',
        basis: `${clusters} кластер(а/ов) × ${ha ? '2 (HA)' : '1'}`,
      },
      {
        key: 'target_throughput',
        label: 'Target security throughput',
        value: round(targetSecurityThroughput, 2),
        unit: 'Гбит/с',
        basis: `Internet + East-West + ${headroom}% запаса`,
      },
      {
        key: 'tls_throughput',
        label: 'TLS inspection target',
        value: round(tlsThroughput, 2),
        unit: 'Гбит/с',
        basis: `${tlsPercent}% интернет-трафика + запас`,
      },
      {
        key: 'sessions',
        label: 'Пиковые сессии',
        value: compact(concurrentSessions),
        unit: 'сессий',
        basis: 'из телеметрии/опросника',
      },
      {
        key: 'cps',
        label: 'Новые соединения',
        value: compact(cps),
        unit: 'CPS',
        basis: 'пиковое значение',
      },
      {
        key: 'migration_batches',
        label: 'Пакеты миграции правил',
        value: migrationBatches,
        unit: 'пак.',
        basis: 'до 100 правил/контрольную волну',
      },
      {
        key: 'zone_pairs',
        label: 'Потенциальные пары зон',
        value: zonePairs,
        unit: 'пар',
        basis: `${zones} зон, верхняя оценка`,
      },
      {
        key: 'vpn',
        label: 'VPN-нагрузка',
        value: `${vpnUsers} users / ${siteVpn} site-to-site`,
        basis: 'из пресейл-опросника',
      },
    ],
    warnings,
    tzSections: [
      {
        code: '4.1.1',
        title: 'Надежность',
        items: [
          `${clusters} HA-кластер(а/ов)`,
          `доступность ${availability}%`,
          'сценарий failover и rollback',
        ],
      },
      {
        code: '4.1.2',
        title: 'Защита информации',
        items: [
          `${zones} зон безопасности`,
          `${rules} правил к миграции`,
          ips ? 'IPS включен' : 'IPS не заявлен',
          `TLS inspection ${tlsPercent}%`,
        ],
      },
      {
        code: '4.1.4',
        title: 'Производительность',
        items: [
          `${round(targetSecurityThroughput, 2)} Гбит/с target`,
          `${compact(concurrentSessions)} сессий`,
          `${compact(cps)} CPS`,
        ],
      },
      {
        code: '4.1.6',
        title: 'Интеграции',
        items: [
          `${integrations} инфраструктурных интеграций`,
          siem ? 'передача событий в SIEM' : 'SIEM не заявлен',
          `${siteVpn} site-to-site VPN`,
        ],
      },
      {
        code: '6.1',
        title: 'Приемочные испытания',
        items: [
          'позитивные/негативные сетевые потоки',
          'failover HA',
          'нагрузочный профиль',
          'rollback',
        ],
      },
    ],
    pmiScenarios: [
      {
        code: 'ПМИ-NGFW-01',
        title: 'Матрица сетевых доступов',
        method: 'Проверка согласованных разрешенных и запрещенных потоков между зонами.',
        expectedResult: 'Разрешенные соединения проходят, запрещенные блокируются и журналируются.',
      },
      {
        code: 'ПМИ-NGFW-02',
        title: 'Производительность',
        method: `Генерация согласованного трафика до ${round(targetSecurityThroughput, 2)} Гбит/с с включенными целевыми сервисами безопасности.`,
        expectedResult: performanceCriterion,
      },
      {
        code: 'ПМИ-NGFW-03',
        title: 'HA / Failover',
        method: 'Отключение активного узла кластера в тестовом контуре и контроль ключевых сессий.',
        expectedResult:
          'Трафик восстанавливается на резервном узле, конфигурация остается согласованной.',
      },
      {
        code: 'ПМИ-NGFW-04',
        title: 'IPS / TLS inspection',
        method:
          'Воспроизведение тестовой сигнатуры и HTTPS-сценариев с разрешенными и исключенными категориями.',
        expectedResult:
          'Политики применяются в соответствии с матрицей, критичные исключенные приложения сохраняют работоспособность.',
      },
    ],
    gostRequirements: requirements,
  };
}
