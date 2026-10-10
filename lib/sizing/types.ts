import type { LookupTable } from './expression';

/** Технические метрики потребности. Это не закупаемые SKU. */
export const SIZING_METRIC_KINDS = [
  'cpu',
  'ram',
  'disk',
  'eps',
  'throughput',
  'sessions',
  'nodes',
  'licenses',
  'count',
  'other',
] as const;
export type SizingMetricKind = (typeof SIZING_METRIC_KINDS)[number];

export const SIZING_VERSION_STATUSES = ['draft', 'approved', 'archived'] as const;
export type SizingVersionStatus = (typeof SIZING_VERSION_STATUSES)[number];

export const SIZING_RUN_SOURCES = ['profile', 'manual'] as const;
export type SizingRunSource = (typeof SIZING_RUN_SOURCES)[number];

export const SIZING_EDIT_ROLES = ['admin', 'architect'];

export interface SizingInputDef {
  key: string;
  label: string;
  type: 'number' | 'boolean' | 'text';
  unit?: string;
  /**
   * Значение по умолчанию — это допущение профиля: оно применяется, только если
   * параметр не задан, и всегда попадает в список допущений прогона.
   * Без default отсутствующий параметр остаётся неизвестным (не 0).
   */
  default?: number | boolean | string;
  /** Нижняя/верхняя граница: значение вне диапазона ограничивается с предупреждением. */
  min?: number;
  max?: number;
}

export interface SizingDerivedDef {
  key: string;
  formula: string;
}

export interface SizingOutputDef {
  key: string;
  label: string;
  kind: SizingMetricKind;
  unit: string;
  formula: string;
  /** ceil/floor — до целого; число — знаков после запятой. По умолчанию без округления. */
  round?: 'ceil' | 'floor' | number;
  basis?: string;
}

export interface SizingScenarioDef {
  key: string;
  label: string;
  /** Переопределения входов: формулы, вычисляемые по входам базового сценария. */
  overrides: Record<string, string>;
}

export interface SizingRules {
  inputs: SizingInputDef[];
  derived: SizingDerivedDef[];
  outputs: SizingOutputDef[];
  scenarios: SizingScenarioDef[];
  tables: Record<string, LookupTable>;
}

export interface SizingInputValue {
  key: string;
  label: string;
  value: number | boolean | string | null;
  /** answer — задано пользователем; assumption — default профиля; missing — неизвестно. */
  origin: 'answer' | 'assumption' | 'missing' | 'scenario';
  unit?: string;
}

export interface SizingOutputValue {
  key: string;
  label: string;
  kind: SizingMetricKind;
  unit: string;
  /** null — невозможно рассчитать: не хватает входных данных. */
  value: number | null;
  /** Входы без значения, из-за которых метрика неизвестна. */
  missing: string[];
  /** Входы, взятые из допущений профиля. */
  assumptions: string[];
  basis: string;
}

export interface SizingScenarioResult {
  key: string;
  label: string;
  inputs: SizingInputValue[];
  outputs: SizingOutputValue[];
  warnings: string[];
}

export interface SizingEvaluation {
  scenarios: SizingScenarioResult[];
}

export interface SizingProfileVersionView {
  id: string;
  profileId: string;
  profileKey: string;
  profileName: string;
  domain: string;
  version: number;
  status: SizingVersionStatus;
  rules: SizingRules;
  assumptions: string[];
  source: string;
  createdBy: string;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
}

export interface SizingProfileView {
  id: string;
  key: string;
  name: string;
  domain: string;
  description: string;
  archived: boolean;
  versions: SizingProfileVersionView[];
}

export interface SizingRunView {
  id: string;
  calculationId: string;
  source: SizingRunSource;
  profileVersionId: string | null;
  profile: { key: string; name: string; version: number } | null;
  inputs: Record<string, unknown>;
  scenarios: Array<{ key: string; label: string }>;
  outputs: Record<string, SizingOutputValue[]>;
  /** Полные результаты по сценариям (входы с происхождением и предупреждения). */
  results: SizingScenarioResult[];
  note: string;
  createdBy: string;
  createdAt: string;
}
