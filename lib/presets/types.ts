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

export type PresetCategory =
  | 'security' // средства защиты информации
  | 'hardware_pac' // серверное оборудование и ПАК
  | 'compliance' // КИИ / ГИС / аттестация
  | 'development' // заказная разработка
  | 'migration' // импортозамещение и миграции
  | 'monitoring' // SIEM / SOC / мониторинг ИБ
  | 'infrastructure'; // резервное копирование, виртуализация, VDI

export interface IndustryPreset {
  id: string;
  name: string;
  category: PresetCategory;
  description: string;
  workDayHours: number;
  includeWeekends: boolean;
  defaultMarginPercent: number;
  defaultRoleRates?: Record<string, number>;
  fields: PresetField[];
  stageTemplates: PresetStage[];
  riskTemplates: PresetRisk[];
}
