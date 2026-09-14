import type { Gost34RequirementItem } from '../types';

export type TorTemplateCategory =
  | 'development' // Веб-платформы, микросервисы, интеграции
  | 'enterprise' // ERP, CRM, логистика, ЭДО
  | 'fintech' // Банки, ДБО, платежные системы, антифрод
  | 'security' // ИБ, SIEM, СЗИ, мониторинг
  | 'compliance' // ГИС, КИИ, регуляторика ФСТЭК/ФСБ
  | 'data_bi' // Озера данных, DWH, BI, ETL
  | 'infrastructure'; // ПАК, СУБД, катастрофоустойчивость

export interface Gost34TorTemplate {
  id: string;
  name: string;
  shortName: string;
  category: TorTemplateCategory;
  categoryLabel: string;
  description: string;
  targetProfileId: string;
  systemType: string;
  systemNameDefault: string;
  customerDefault?: string;
  icon: string;
  requirements: Gost34RequirementItem[];
  metadata?: {
    scopeSummary?: string;
    applicableStandards?: string[];
  };
}
