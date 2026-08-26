/**
 * Библиотека отраслевых пресетов (шаблонных расчётов) для рынка РФ.
 *
 * Каждый пресет вынесен в отдельный модуль в `./presets/`; здесь — только
 * сборка и порядок отображения. Типы — в `./types`; реэкспортируются для
 * обратной совместимости с прежним путём импорта.
 */

import { IndustryPreset } from './types';
import { NGFW_SZI_PRESET } from './presets/ngfwSzi';
import { HARDWARE_PAC_DB_PRESET } from './presets/hardwarePacDb';
import { KII_GIS_COMPLIANCE_PRESET } from './presets/kiiGisCompliance';
import { CUSTOM_DEVELOPMENT_API_PRESET } from './presets/customDevelopmentApi';
import { IMPORT_SUBSTITUTION_MIGRATION_PRESET } from './presets/importSubstitutionMigration';
import { SIEM_MONITORING_PRESET } from './presets/siemMonitoring';
import { BACKUP_DR_PRESET } from './presets/backupDr';

export type { IndustryPreset, PresetCategory, PresetField, PresetRisk, PresetStage } from './types';

export const INDUSTRY_PRESETS: IndustryPreset[] = [
  NGFW_SZI_PRESET,
  HARDWARE_PAC_DB_PRESET,
  KII_GIS_COMPLIANCE_PRESET,
  CUSTOM_DEVELOPMENT_API_PRESET,
  IMPORT_SUBSTITUTION_MIGRATION_PRESET,
  SIEM_MONITORING_PRESET,
  BACKUP_DR_PRESET,
];
