/**
 * Библиотека отраслевых пресетов (шаблонных расчётов) для рынка РФ.
 *
 * Каждый пресет вынесен в отдельный модуль в `./presets/`; здесь — только
 * сборка и порядок отображения. Типы — в `./types`; реэкспортируются для
 * обратной совместимости с прежним путём импорта.
 */

import { IndustryPreset, PresetField } from './types';
import { NGFW_SZI_PRESET } from './presets/ngfwSzi';
import { HARDWARE_PAC_DB_PRESET } from './presets/hardwarePacDb';
import { KII_GIS_COMPLIANCE_PRESET } from './presets/kiiGisCompliance';
import { CUSTOM_DEVELOPMENT_API_PRESET } from './presets/customDevelopmentApi';
import { ERP_CRM_ENTERPRISE_PRESET } from './presets/erpCrmEnterprise';
import { FINTECH_BANKING_PLATFORM_PRESET } from './presets/fintechBankingPlatform';
import { DATA_LAKE_BI_PLATFORM_PRESET } from './presets/dataLakeBiPlatform';
import { IMPORT_SUBSTITUTION_MIGRATION_PRESET } from './presets/importSubstitutionMigration';
import { SIEM_MONITORING_PRESET } from './presets/siemMonitoring';
import { BACKUP_DR_PRESET } from './presets/backupDr';

export type { IndustryPreset, PresetCategory, PresetField, PresetRisk, PresetStage } from './types';

/**
 * ГОСТ 34.602 требует указать в «Общих сведениях» источники и порядок
 * финансирования работ. Без ответа генератор ставит major-gap «требует
 * уточнения», поэтому поле нужно в каждом опроснике — добавляем его при сборке
 * библиотеки, а не копируем в каждый модуль пресета.
 */
const COMMON_GOST_FIELDS: ReadonlyArray<Omit<PresetField, 'order'>> = [
  {
    label: 'Источники и порядок финансирования работ',
    key: 'funding_source',
    type: 'textarea',
    required: false,
  },
];

function withCommonGostFields(preset: IndustryPreset): IndustryPreset {
  const missing = COMMON_GOST_FIELDS.filter(
    (common) => !preset.fields.some((field) => field.key === common.key),
  );
  if (missing.length === 0) return preset;

  let order = preset.fields.reduce((max, field) => Math.max(max, field.order), -1);
  return {
    ...preset,
    fields: [...preset.fields, ...missing.map((common) => ({ ...common, order: ++order }))],
  };
}

export const INDUSTRY_PRESETS: IndustryPreset[] = [
  NGFW_SZI_PRESET,
  HARDWARE_PAC_DB_PRESET,
  KII_GIS_COMPLIANCE_PRESET,
  CUSTOM_DEVELOPMENT_API_PRESET,
  ERP_CRM_ENTERPRISE_PRESET,
  FINTECH_BANKING_PLATFORM_PRESET,
  DATA_LAKE_BI_PLATFORM_PRESET,
  IMPORT_SUBSTITUTION_MIGRATION_PRESET,
  SIEM_MONITORING_PRESET,
  BACKUP_DR_PRESET,
].map(withCommonGostFields);
