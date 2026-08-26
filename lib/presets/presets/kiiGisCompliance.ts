import { IndustryPreset } from '../types';

export const KII_GIS_COMPLIANCE_PRESET: IndustryPreset = {
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
      options: [
        '1 категория КИИ / К1 ГИС / УЗ-1',
        '2 категория КИИ / К2 ГИС / УЗ-2',
        '3 категория КИИ / К3 ГИС / УЗ-3',
      ],
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
      description:
        'Замечания регулятора (ФСТЭК/ФСБ) к сведениям о результатах присвоения категории объектам КИИ.',
      hours: 16,
      order: 0,
    },
    {
      description:
        'Задержка Заказчиком утверждения состава комиссии по категорированию и подписания ОРД.',
      hours: 12,
      order: 1,
    },
    {
      description:
        'Необходимость доработки прикладных ИТ-систем для поддержки механизмов двухфакторной аутентификации.',
      hours: 20,
      order: 2,
    },
  ],
};
