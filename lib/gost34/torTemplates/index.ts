import { Gost34TorTemplate, TorTemplateCategory } from './types';
import type { Gost34RequirementItem } from '../types';
import { TOR_WEB_MICROSERVICES } from './templates/webMicroservices';
import { TOR_ERP_CRM_ENTERPRISE } from './templates/erpCrmEnterprise';
import { TOR_FINTECH_BANKING } from './templates/fintechBanking';
import { TOR_GIS_KII_FSTEK } from './templates/gisKiiFstek';
import { TOR_DATA_LAKE_BI } from './templates/dataLakeBi';
import { TOR_SIEM_SOC_MONITORING } from './templates/siemSocMonitoring';
import { TOR_INFRASTRUCTURE_PAC_DB } from './templates/infrastructurePacDb';

export * from './types';
export { TOR_WEB_MICROSERVICES } from './templates/webMicroservices';
export { TOR_ERP_CRM_ENTERPRISE } from './templates/erpCrmEnterprise';
export { TOR_FINTECH_BANKING } from './templates/fintechBanking';
export { TOR_GIS_KII_FSTEK } from './templates/gisKiiFstek';
export { TOR_DATA_LAKE_BI } from './templates/dataLakeBi';
export { TOR_SIEM_SOC_MONITORING } from './templates/siemSocMonitoring';
export { TOR_INFRASTRUCTURE_PAC_DB } from './templates/infrastructurePacDb';

export const GOST34_TOR_TEMPLATES: Gost34TorTemplate[] = [
  TOR_WEB_MICROSERVICES,
  TOR_ERP_CRM_ENTERPRISE,
  TOR_FINTECH_BANKING,
  TOR_GIS_KII_FSTEK,
  TOR_DATA_LAKE_BI,
  TOR_SIEM_SOC_MONITORING,
  TOR_INFRASTRUCTURE_PAC_DB,
];

/**
 * Получить список всех доступных детализированных шаблонов ТЗ по ГОСТ 34.602-2020.
 */
export function listTorTemplates(): Gost34TorTemplate[] {
  return GOST34_TOR_TEMPLATES;
}

/**
 * Найти шаблон ТЗ по его уникальному идентификатору.
 */
export function getTorTemplateById(id: string): Gost34TorTemplate | undefined {
  return GOST34_TOR_TEMPLATES.find((t) => t.id === id);
}

/**
 * Фильтровать шаблоны по категории.
 */
export function getTorTemplatesByCategory(category: TorTemplateCategory): Gost34TorTemplate[] {
  return GOST34_TOR_TEMPLATES.filter((t) => t.category === category);
}

/**
 * Применить шаблон ТЗ к текущему набору требований (полная замена или добавление).
 */
export function applyTorTemplate(options: {
  template: Gost34TorTemplate;
  currentRequirements: Gost34RequirementItem[];
  mode: 'replace' | 'append';
}): Gost34RequirementItem[] {
  const { template, currentRequirements, mode } = options;

  if (mode === 'replace') {
    return template.requirements.map((req, idx) => ({
      ...req,
      id: `req-${template.id}-${idx + 1}-${Date.now()}`,
    }));
  }

  // mode === 'append'
  const existingCodes = new Set(currentRequirements.map((r) => r.code));
  const newItems: Gost34RequirementItem[] = [];

  for (let i = 0; i < template.requirements.length; i++) {
    const orig = template.requirements[i];
    let targetCode = orig.code;
    if (existingCodes.has(targetCode)) {
      // Подбираем уникальный суффикс
      let counter = 2;
      while (existingCodes.has(`${orig.code}-${counter}`)) {
        counter++;
      }
      targetCode = `${orig.code}-${counter}`;
    }
    existingCodes.add(targetCode);

    newItems.push({
      ...orig,
      id: `req-${template.id}-${i + 1}-${Date.now()}`,
      code: targetCode,
    });
  }

  return [...currentRequirements, ...newItems];
}
