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
import { ERP_CRM_ENTERPRISE_PRESET } from './presets/erpCrmEnterprise';
import { FINTECH_BANKING_PLATFORM_PRESET } from './presets/fintechBankingPlatform';
import { DATA_LAKE_BI_PLATFORM_PRESET } from './presets/dataLakeBiPlatform';
import { IMPORT_SUBSTITUTION_MIGRATION_PRESET } from './presets/importSubstitutionMigration';
import { SIEM_MONITORING_PRESET } from './presets/siemMonitoring';
import { IDM_ACCESS_MANAGEMENT_PRESET } from './presets/idmAccessManagement';
import { NGFW_IMPLEMENTATION_PRESET } from './presets/ngfwImplementation';
import { BACKUP_DR_PRESET } from './presets/backupDr';

export type { IndustryPreset, PresetCategory, PresetField, PresetRisk, PresetStage } from './types';

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
  IDM_ACCESS_MANAGEMENT_PRESET,
  NGFW_IMPLEMENTATION_PRESET,
  BACKUP_DR_PRESET,
];
