import { IndustryPreset } from '../types';

export const NGFW_SZI_PRESET: IndustryPreset = {
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
    {
      label: 'Цели создания системы (через точку с запятой)',
      key: 'project_goals',
      type: 'textarea',
      required: false,
      order: 6,
    },
    {
      label: 'Измеримые критерии достижения целей («показатель = целевое значение»)',
      key: 'goal_criteria',
      type: 'textarea',
      required: false,
      order: 7,
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
        'Исполнитель обязан провести аудит сетевого периметра, выполнить классификацию обрабатываемых данных (152-ФЗ, КИИ) и сформировать матрицу сетевых доступов.',
      order: 0,
    },
    {
      name: 'Поставка лицензий и формуляров СЗИ (UserGate, Kaspersky, Cyberpeak, ViPNet)',
      role: 'engineer',
      baseHours: 12,
      hoursPerUnit: 0.1,
      driverFieldKey: 'endpoints_count',
      requirements:
        'Исполнитель обязан проконтролировать наличие лицензий из Единого реестра ПО (188-ФЗ), формуляров со знаками соответствия ФСТЭК/ФСБ, дистрибутивов и ключей активации.',
      order: 1,
    },
    {
      name: 'Монтаж, развертывание и кластеризация NGFW UserGate',
      role: 'engineer',
      baseHours: 20,
      hoursPerUnit: 16,
      driverFieldKey: 'ngfw_clusters_count',
      requirements:
        'Исполнитель обязан настроить HA-кластер Active-Passive, правила фильтрации L4-L7, инспекцию SSL/TLS, системы предотвращения вторжений (IPS) и профили контентной фильтрации.',
      order: 2,
    },
    {
      name: 'Настройка защиты рабочих станций Kaspersky и аудита хранилищ Cyberpeak',
      role: 'engineer',
      baseHours: 16,
      hoursPerUnit: 0.2,
      driverFieldKey: 'endpoints_count',
      requirements:
        'Исполнитель обязан развернуть Kaspersky Security Center и политики EDR и настроить сборщики событий Cyberpeak для файловых серверов и СХД.',
      order: 3,
    },
    {
      name: 'Настройка шифрованных туннелей ViPNet ГОСТ-VPN',
      role: 'engineer',
      baseHours: 12,
      hoursPerUnit: 6,
      driverFieldKey: 'vpn_tunnels_count',
      requirements:
        'Исполнитель обязан инициализировать ключевые носители и настроить ViPNet Coordinator HW и клиентские узлы ViPNet Client с криптографической защитой ГОСТ.',
      order: 4,
    },
    {
      name: 'Разработка комплекта ОРД и приёмочные испытания по ПМИ',
      role: 'consultant',
      baseHours: 24,
      hoursPerUnit: 4,
      driverFieldKey: 'storage_audits_count',
      requirements:
        'Исполнитель обязан разработать регламенты реагирования на инциденты и инструкции администраторов и провести приёмочные испытания по методике ПМИ.',
      order: 5,
    },
  ],
  riskTemplates: [
    {
      description:
        'Задержка согласования Заказчиком правил межсетевого экранирования и открываемых портов.',
      hours: 12,
      order: 0,
    },
    {
      description:
        'Несовместимость стороннего ПО рабочих мест с антивирусными агентами и драйверами СЗИ от НСД.',
      hours: 16,
      order: 1,
    },
    {
      description:
        'Длительное получение ключевых дистрибутивов и сертификатов от регулятора ФСБ/ФСТЭК.',
      hours: 8,
      order: 2,
    },
  ],
};
