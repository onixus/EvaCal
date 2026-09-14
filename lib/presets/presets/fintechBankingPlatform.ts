import { IndustryPreset } from '../types';

export const FINTECH_BANKING_PLATFORM_PRESET: IndustryPreset = {
  id: 'preset-fintech-banking-platform',
  name: 'Автоматизированная банковская система (АБС, ДБО, СБП, ГОСТ 57580)',
  category: 'development',
  description:
    'Высоконагруженная банковская платформа: процессинг платежей, интеграция с СБП и НСПК, личный кабинет ДБО, криптозащита с HSM по ГОСТ, соответствие требованиям Положения 683-П / 757-П ЦБ РФ.',
  workDayHours: 6,
  includeWeekends: false,
  defaultMarginPercent: 25,
  defaultRoleRates: {
    architect: 5000,
    engineer: 3800,
    analyst: 3800,
    consultant: 4200,
    developer: 4200,
    pm: 4200,
  },
  fields: [
    {
      label: 'Количество платёжных методов и внешних шлюзов (СБП, МИР, Корсчета ЦБ РФ, СМЭВ)',
      key: 'payment_methods_count',
      type: 'number',
      required: true,
      order: 0,
    },
    {
      label: 'Плановый объём обслуживаемых активных счетов (в тысячах счетов)',
      key: 'accounts_scale_thousands',
      type: 'number',
      required: true,
      order: 1,
    },
    {
      label: 'Количество аппаратных модулей шифрования (HSM) и шлюзов ГОСТ-криптографии',
      key: 'crypto_gateways_count',
      type: 'number',
      required: true,
      order: 2,
    },
    {
      label: 'Количество клиентских интерфейсов (Веб-банк, Мобильный ДБО, Open API для финтеха)',
      key: 'interfaces_count',
      type: 'number',
      required: true,
      order: 3,
    },
    {
      label: 'Уровень требований ИБ и отказоустойчивости (ГОСТ 57580, PCI DSS, 683-П)',
      key: 'complexity',
      type: 'complexity',
      required: true,
      order: 4,
    },
    {
      label: 'Требования к катастрофоустойчивому RPO/RTO и территориально распределённому ЦОД',
      key: 'comment',
      type: 'textarea',
      required: false,
      order: 5,
    },
  ],
  stageTemplates: [
    {
      name: 'Разработка технического задания по ГОСТ 34 и спецификаций ISO 20022',
      role: 'analyst',
      baseHours: 32,
      hoursPerUnit: 4,
      driverFieldKey: 'payment_methods_count',
      requirements:
        'Исполнитель обязан проанализировать регуляторные требования Банка России, спецификации протоколов СБП и схемы валидации платежей.',
      order: 0,
    },
    {
      name: 'Архитектурное проектирование транзакционного ядра и интеграции с HSM',
      role: 'architect',
      baseHours: 30,
      hoursPerUnit: 6,
      driverFieldKey: 'crypto_gateways_count',
      requirements:
        'Исполнитель обязан спроектировать распределённую балансовую модель, механизм двухфазного подтверждения транзакций и интерфейсы PKCS#11.',
      order: 1,
    },
    {
      name: 'Разработка платёжных адаптеров, расчётных шлюзов и протоколов СБП',
      role: 'developer',
      baseHours: 36,
      hoursPerUnit: 10,
      driverFieldKey: 'payment_methods_count',
      requirements:
        'Исполнитель обязан реализовать коннекторы к НСПК, обработку клиринговых рейсов и обработку сценариев C2B/C2C платежей.',
      order: 2,
    },
    {
      name: 'Разработка сервисов онлайн-антифрода, лимитов и интерфейсов ДБО',
      role: 'developer',
      baseHours: 32,
      hoursPerUnit: 8,
      driverFieldKey: 'interfaces_count',
      requirements:
        'Исполнитель обязан реализовать правила проверки подозрительных операций, генерацию выписок и витрины счетов для клиентов.',
      order: 3,
    },
    {
      name: 'Стресс-тестирование пикового TPS, отказоустойчивости Multi-DC и ПМИ',
      role: 'engineer',
      baseHours: 28,
      hoursPerUnit: 0.1,
      driverFieldKey: 'accounts_scale_thousands',
      requirements:
        'Исполнитель обязан выполнить нагрузочные замеры на 5000+ TPS и эмуляцию аварийного переключения на резервный ЦОД с сохранением консистентности.',
      order: 4,
    },
    {
      name: 'Аудит соответствия требованиям Банка России (ГОСТ 57580.1) и сдача системы',
      role: 'consultant',
      baseHours: 24,
      hoursPerUnit: 2,
      driverFieldKey: 'crypto_gateways_count',
      requirements:
        'Исполнитель обязан проверить выполнение мер защиты информации, подготовить комплект эксплуатационной документации и оформить акт приемки.',
      order: 5,
    },
  ],
  riskTemplates: [
    {
      description:
        'Длительный цикл согласований и проверок на внешних тестовых контурах НСПК и Банка России.',
      hours: 24,
      order: 0,
    },
    {
      description:
        'Аппаратные задержки криптографических модулей HSM при пиковой транзакционной нагрузке.',
      hours: 16,
      order: 1,
    },
    {
      description:
        'Внесение изменений в форматы электронных сообщений ЦБ РФ в процессе приёмочных испытаний.',
      hours: 16,
      order: 2,
    },
  ],
};
