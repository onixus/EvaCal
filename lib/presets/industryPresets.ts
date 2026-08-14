export interface PresetField {
  label: string;
  key: string;
  type: 'text' | 'number' | 'select' | 'checkbox' | 'textarea' | 'complexity';
  options?: string[];
  required: boolean;
  order: number;
}

export interface PresetStage {
  name: string;
  role: 'consultant' | 'developer' | 'engineer' | 'analyst' | 'architect' | 'pm' | 'other';
  baseHours: number;
  hoursPerUnit: number;
  driverFieldKey: string | null;
  requirements?: string;
  order: number;
}

export interface PresetRisk {
  description: string;
  hours: number;
  order: number;
}

export interface IndustryPreset {
  id: string;
  name: string;
  category: 'security' | 'hardware_pac' | 'compliance' | 'development';
  description: string;
  workDayHours: number;
  includeWeekends: boolean;
  defaultMarginPercent: number;
  defaultRoleRates?: Record<string, number>;
  fields: PresetField[];
  stageTemplates: PresetStage[];
  riskTemplates: PresetRisk[];
}

export const INDUSTRY_PRESETS: IndustryPreset[] = [
  {
    id: 'preset-ngfw-szi',
    name: 'Внедрение систем ИБ (UserGate, Kaspersky, Cyberpeak, ViPNet)',
    category: 'security',
    description:
      'Типовой проект внедрения средств защиты информации: межсетевые экраны NGFW UserGate, антивирусная защита Kaspersky Endpoint Security, аудит хранилищ Cyberpeak и каналы ViPNet ГОСТ-VPN.',
    workDayHours: 6,
    includeWeekends: false,
    defaultMarginPercent: 25,
    defaultRoleRates: {
      architect: 4500,
      engineer: 3600,
      analyst: 3200,
      consultant: 4000,
      developer: 3400,
      pm: 3800,
    },
    fields: [
      {
        label: 'Количество кластеров NGFW (UserGate)',
        key: 'ngfw_clusters_count',
        type: 'number',
        required: true,
        order: 0,
      },
      {
        label: 'Количество защищаемых рабочих станций/серверов (Kaspersky)',
        key: 'endpoints_count',
        type: 'number',
        required: true,
        order: 1,
      },
      {
        label: 'Количество файловых хранилищ для аудита (Cyberpeak)',
        key: 'storage_audits_count',
        type: 'number',
        required: true,
        order: 2,
      },
      {
        label: 'Количество шлюзов/туннелей ГОСТ-VPN (ViPNet Coordinator)',
        key: 'vpn_tunnels_count',
        type: 'number',
        required: true,
        order: 3,
      },
      {
        label: 'Сложность контура безопасности',
        key: 'complexity',
        type: 'complexity',
        required: true,
        order: 4,
      },
      {
        label: 'Дополнительные требования к контуру ИБ',
        key: 'comment',
        type: 'textarea',
        required: false,
        order: 5,
      },
    ],
    stageTemplates: [
      {
        name: 'Обследование инфраструктуры и разработка Частной модели угроз',
        role: 'consultant',
        baseHours: 24,
        hoursPerUnit: 2,
        driverFieldKey: 'ngfw_clusters_count',
        requirements:
          'Аудит сетевого периметра, классификация обрабатываемых данных (152-ФЗ, КИИ), формирование матрицы сетевых доступов.',
        order: 0,
      },
      {
        name: 'Поставка лицензий и формуляров СЗИ (UserGate, Kaspersky, Cyberpeak, ViPNet)',
        role: 'engineer',
        baseHours: 12,
        hoursPerUnit: 0.1,
        driverFieldKey: 'endpoints_count',
        requirements:
          'Контроль наличия лицензий из Единого реестра ПО (188-ФЗ), формуляров со знаками соответствия ФСТЭК/ФСБ, дистрибутивов и ключей активации.',
        order: 1,
      },
      {
        name: 'Монтаж, развертывание и кластеризация NGFW UserGate',
        role: 'engineer',
        baseHours: 20,
        hoursPerUnit: 16,
        driverFieldKey: 'ngfw_clusters_count',
        requirements:
          'Настройка HA-кластера Active-Passive, правил фильтрации L4-L7, инспекции SSL/TLS, систем предотвращения вторжений (IPS) и профилей контентной фильтрации.',
        order: 2,
      },
      {
        name: 'Настройка защиты рабочих станций Kaspersky и аудита хранилищ Cyberpeak',
        role: 'engineer',
        baseHours: 16,
        hoursPerUnit: 0.2,
        driverFieldKey: 'endpoints_count',
        requirements:
          'Развертывание Kaspersky Security Center, политик EDR, настройка сборщиков событий Cyberpeak для файловых серверов и СХД.',
        order: 3,
      },
      {
        name: 'Настройка шифрованных туннелей ViPNet ГОСТ-VPN',
        role: 'engineer',
        baseHours: 12,
        hoursPerUnit: 6,
        driverFieldKey: 'vpn_tunnels_count',
        requirements:
          'Инициализация ключевых носителей, настройка ViPNet Coordinator HW и клиентских узлов ViPNet Client с криптографической защитой ГОСТ.',
        order: 4,
      },
      {
        name: 'Разработка комплекта ОРД и приёмочные испытания по ПМИ',
        role: 'consultant',
        baseHours: 24,
        hoursPerUnit: 4,
        driverFieldKey: 'storage_audits_count',
        requirements:
          'Разработка регламентов реагирования на инциденты, инструкций администраторов и проведение приёмочных испытаний по методике ПМИ.',
        order: 5,
      },
    ],
    riskTemplates: [
      {
        description: 'Задержка согласования Заказчиком правил межсетевого экранирования и открываемых портов.',
        hours: 12,
        order: 0,
      },
      {
        description: 'Несовместимость стороннего ПО рабочих мест с антивирусными агентами и драйверами СЗИ от НСД.',
        hours: 16,
        order: 1,
      },
      {
        description: 'Длительное получение ключевых дистрибутивов и сертификатов от регулятора ФСБ/ФСТЭК.',
        hours: 8,
        order: 2,
      },
    ],
  },
  {
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
        description: 'Задержки логистики серверных платформ и комплектующих (коммутаторы, контроллеры RAID, трансиверы SFP+).',
        hours: 24,
        order: 0,
      },
      {
        description: 'Неготовность инженерной инфраструктуры ЦОД Заказчика (электропитание, кондиционирование, доступы в машзал).',
        hours: 16,
        order: 1,
      },
      {
        description: 'Специфические требования к согласованию регламентов ТО и сервисных контрактов вендора 24/7.',
        hours: 8,
        order: 2,
      },
    ],
  },
  {
    id: 'preset-kii-gis-compliance',
    name: 'Защита объектов КИИ и ГИС (187-ФЗ, 152-ФЗ, ФСТЭК № 17/21/239)',
    category: 'compliance',
    description:
      'Комплекс работ по категорированию объектов КИИ, аудиту ИСПДн, проектированию систем защиты информации, внедрению СЗИ от НСД, подготовке ОРД и проведению аттестационных испытаний по требованиям регуляторов.',
    workDayHours: 6,
    includeWeekends: false,
    defaultMarginPercent: 30,
    defaultRoleRates: {
      architect: 5000,
      engineer: 3800,
      analyst: 3400,
      consultant: 4200,
      developer: 3500,
      pm: 4000,
    },
    fields: [
      {
        label: 'Количество значимых объектов КИИ (ЗОКИИ)',
        key: 'kii_objects_count',
        type: 'number',
        required: true,
        order: 0,
      },
      {
        label: 'Количество информационных систем / ИСПДн / ГИС',
        key: 'is_systems_count',
        type: 'number',
        required: true,
        order: 1,
      },
      {
        label: 'Количество автоматизированных рабочих мест (АРМ)',
        key: 'workstations_count',
        type: 'number',
        required: true,
        order: 2,
      },
      {
        label: 'Требуемый уровень защищенности (УЗ/К/Категория)',
        key: 'target_security_level',
        type: 'select',
        options: ['1 категория КИИ / К1 ГИС / УЗ-1', '2 категория КИИ / К2 ГИС / УЗ-2', '3 категория КИИ / К3 ГИС / УЗ-3'],
        required: true,
        order: 3,
      },
      {
        label: 'Сложность организационной структуры Заказчика',
        key: 'complexity',
        type: 'complexity',
        required: true,
        order: 4,
      },
      {
        label: 'Дополнительные регуляторные требования (ЦБ РФ 757-П, ФСБ 378)',
        key: 'comment',
        type: 'textarea',
        required: false,
        order: 5,
      },
    ],
    stageTemplates: [
      {
        name: 'Предпроектное обследование и категорирование объектов КИИ (187-ФЗ)',
        role: 'consultant',
        baseHours: 30,
        hoursPerUnit: 10,
        driverFieldKey: 'kii_objects_count',
        requirements:
          'Создание комиссии по категорированию, сбор исходных данных, оценка показателей критериев значимости, оформление актов категорирования и сведений для ФСТЭК.',
        order: 0,
      },
      {
        name: 'Разработка Модели угроз и Технического задания на систему защиты (СЗИ)',
        role: 'analyst',
        baseHours: 24,
        hoursPerUnit: 8,
        driverFieldKey: 'is_systems_count',
        requirements:
          'Моделирование нарушителя по методике ФСТЭК России 2021 г., формирование перечня актуальных угроз и требований к подсистемам СЗИ.',
        order: 1,
      },
      {
        name: 'Внедрение СЗИ от несанкционированного доступа (Secret Net / Dallas Lock / Соболь)',
        role: 'engineer',
        baseHours: 16,
        hoursPerUnit: 0.5,
        driverFieldKey: 'workstations_count',
        requirements:
          'Установка аппаратных модулей доверенной загрузки (АПМДЗ), настройка замков, дискреционного и мандатного разграничения доступа, контроля целостности и аудита.',
        order: 2,
      },
      {
        name: 'Разработка комплекта организационно-распорядительной документации (ОРД)',
        role: 'consultant',
        baseHours: 28,
        hoursPerUnit: 6,
        driverFieldKey: 'is_systems_count',
        requirements:
          'Политика информационной безопасности, регламенты резервного копирования, антивирусного контроля, обращения с криптосредствами, матрицы доступа и приказы о назначении ответственных лиц.',
        order: 3,
      },
      {
        name: 'Проведение аттестационных испытаний объекта информатизации',
        role: 'consultant',
        baseHours: 32,
        hoursPerUnit: 12,
        driverFieldKey: 'kii_objects_count',
        requirements:
          'Инструментальный контроль эффективности принятых мер защиты, сканирование уязвимостей, анализ журналов и оформление Аттестата соответствия требованиям безопасности информации.',
        order: 4,
      },
    ],
    riskTemplates: [
      {
        description: 'Замечания регулятора (ФСТЭК/ФСБ) к сведениям о результатах присвоения категории объектам КИИ.',
        hours: 16,
        order: 0,
      },
      {
        description: 'Задержка Заказчиком утверждения состава комиссии по категорированию и подписания ОРД.',
        hours: 12,
        order: 1,
      },
      {
        description: 'Необходимость доработки прикладных ИТ-систем для поддержки механизмов двухфакторной аутентификации.',
        hours: 20,
        order: 2,
      },
    ],
  },
  {
    id: 'preset-custom-development-api',
    name: 'Заказная разработка и интеграции (Микросервисы, REST/Kafka, 1С, СМЭВ)',
    category: 'development',
    description:
      'Проект заказной разработки корпоративной информационной системы, интеграционной шины данных, сервисов обмена по REST/SOAP/Kafka, интеграции с 1С:ERP и государственными сервисами (СМЭВ/ЕАИС).',
    workDayHours: 6,
    includeWeekends: false,
    defaultMarginPercent: 22,
    defaultRoleRates: {
      architect: 4600,
      engineer: 3500,
      analyst: 3400,
      consultant: 3800,
      developer: 3800,
      pm: 3800,
    },
    fields: [
      {
        label: 'Количество внешних систем и шлюзов интеграции (1C, СМЭВ, Kafka, CRM)',
        key: 'integrations_count',
        type: 'number',
        required: true,
        order: 0,
      },
      {
        label: 'Количество пользовательских экранных форм и отчетов',
        key: 'screens_count',
        type: 'number',
        required: true,
        order: 1,
      },
      {
        label: 'Количество бизнес-сущностей и моделей данных',
        key: 'entities_count',
        type: 'number',
        required: true,
        order: 2,
      },
      {
        label: 'Сложность бизнес-логики и сценариев обработки',
        key: 'complexity',
        type: 'complexity',
        required: true,
        order: 3,
      },
      {
        label: 'Требования к отказоустойчивости, шифрованию каналов и очередям',
        key: 'comment',
        type: 'textarea',
        required: false,
        order: 4,
      },
    ],
    stageTemplates: [
      {
        name: 'Системный анализ, прототипирование UI/UX и ТЗ по ГОСТ 34.602',
        role: 'analyst',
        baseHours: 24,
        hoursPerUnit: 2.5,
        driverFieldKey: 'screens_count',
        requirements:
          'Детализация требований пользователей, проектирование экранов, макетов, валидаций и подготовка ТЗ на систему.',
        order: 0,
      },
      {
        name: 'Проектирование архитектуры сервисов, схем БД и спецификаций API (OpenAPI/AsyncAPI)',
        role: 'architect',
        baseHours: 24,
        hoursPerUnit: 4,
        driverFieldKey: 'entities_count',
        requirements:
          'Главный архитектор проекта: декомпозиция на микросервисы, модели данных Postgres, протоколы взаимодействия и схемы очередей Kafka.',
        order: 1,
      },
      {
        name: 'Разработка интеграционных адаптеров и коннекторов к шине (1C, СМЭВ, Kafka)',
        role: 'developer',
        baseHours: 20,
        hoursPerUnit: 14,
        driverFieldKey: 'integrations_count',
        requirements:
          'Реализация REST/SOAP клиентов, обработчиков очередей, маппинга структур данных, механизмов повтора (retry/backoff) и транзакционных логов.',
        order: 2,
      },
      {
        name: 'Разработка прикладных сервисов бизнес-логики и веб-интерфейса',
        role: 'developer',
        baseHours: 32,
        hoursPerUnit: 6,
        driverFieldKey: 'screens_count',
        requirements:
          'Реализация backend API, валидаций, бизнес-правил, ролевой модели (RBAC) и responsive frontend интерфейсов.',
        order: 3,
      },
      {
        name: 'Комплексное интеграционное и нагрузочное тестирование по ПМИ',
        role: 'engineer',
        baseHours: 20,
        hoursPerUnit: 3,
        driverFieldKey: 'screens_count',
        requirements:
          'Автоматизированные e2e тесты, нагрузочное тестирование пиковых TPS, валидация устойчивости при сбоях интеграционных шин.',
        order: 4,
      },
      {
        name: 'Опытная эксплуатация, обучение персонала и сдача системы Заказчику',
        role: 'analyst',
        baseHours: 16,
        hoursPerUnit: 2,
        driverFieldKey: 'integrations_count',
        requirements:
          'Разработка Руководства пользователя, Руководства администратора, проведение обучающих вебинаров и авторский надзор.',
        order: 5,
      },
    ],
    riskTemplates: [
      {
        description: 'Изменение форматов и протоколов обмена со стороны внешних систем (1С/СМЭВ) в процессе разработки.',
        hours: 20,
        order: 0,
      },
      {
        description: 'Отсутствие или нестабильность тестовых стендов смежных систем Заказчика.',
        hours: 16,
        order: 1,
      },
      {
        description: 'Длительное согласование экранных интерфейсов и дополнительных полей со стороны ключевых пользователей.',
        hours: 12,
        order: 2,
      },
    ],
  },
];
