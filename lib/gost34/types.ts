/**
 * GOST 34 / GOST 2.104-2006 / GOST 2.105-95 Domain Types
 */

import type { StandardProfile } from './standards/types';
import type { Gost34RequirementV2 } from './requirements/v2';
import type { ProjectContext } from './context/types';
import type { ValidationReport } from './validation/types';
import type { ApplicabilityResult } from './applicability/types';

export type GostDocumentType = 'TZ' | 'PZ' | 'AF' | 'PMI' | 'SPEC';

/** What an export request may ask for: one document, or the full batch as a ZIP. */
export type GostExportType = GostDocumentType | 'ZIP';

export interface Gost2104Signatures {
  developer: string; // Разработал (ФИО)
  checker: string; // Проверил (ФИО)
  techControl: string; // Т. контр. (ФИО)
  normControl: string; // Н. контр. (ФИО)
  approver: string; // Утвердил (ФИО)
  customerApprover?: string; // Утвердил от Заказчика (ФИО)
  invSubl?: string; // Инв. № подл.
  signDate?: string; // Подп. и дата
  invRepl?: string; // Взам. инв. №
  invDupl?: string; // Инв. № дубл.
}

export interface Gost34EnrichmentOptions {
  fstek_21?: boolean;         // Приказ ФСТЭК № 21 (Защита ИСПДн)
  fstek_117?: boolean;        // Приказ ФСТЭК № 117 + ГОСТ Р 56939-2016 (Безопасная разработка)
  fstek_239?: boolean;        // Приказ ФСТЭК № 239 (Безопасность объектов КИИ)
  gost_57580?: boolean;       // ГОСТ Р 57580.1-2017 / СТО БР ИББС
  cb_683p?: boolean;          // Положение ЦБ РФ № 683-П (Безопасность ПО кредитных организаций)
  cb_757p?: boolean;          // Положение ЦБ РФ № 757-П (Безопасность НФО)
  cb_719p?: boolean;          // Положение ЦБ РФ № 719-П (Антифрод и электронная подпись)
  fsb_282_gossopka?: boolean; // Приказ ФСБ № 282 (Интеграция с ГосСОПКА / НКЦКИ)
  fz_187_kii?: boolean;       // 187-ФЗ (О безопасности КИИ РФ)
  fz_152?: boolean;           // 152-ФЗ / 242-ФЗ (Локализация баз ПДн в РФ)
  fz_188_reestr?: boolean;    // 188-ФЗ (Единый реестр российского ПО, Astra Linux/PostgreSQL)
  sla_999?: boolean;          // SLA 99.9% (RTO ≤ 15 мин, RPO ≤ 5 мин)
  wcag_52872?: boolean;       // ГОСТ Р 52872-2019 / WCAG 2.1 AA (Доступность)
}

export interface Gost34DocMetadata {
  docType: GostDocumentType; // 'TZ' | 'PZ' | 'AF' | 'PMI' | 'SPEC'
  systemName: string; // Имя системы (краткое)
  fullSystemName: string; // Полное наименование системы
  documentCode: string; // Обозначение документа по ГОСТ (например: "АБВГ.123456.001 ТЗ")
  contractNumber?: string; // Номер договора / шифр
  customerName: string; // Наименование Заказчика
  developerName: string; // Наименование Разработчика
  signatures: Gost2104Signatures; // Подписи ГОСТ 2.104 (Разраб., Пров., Н.контр., Утв.)
  city: string; // Город (по умолчанию "Москва")
  year: number; // Год создания
  version: string; // Версия документа
  enrichRequirements?: boolean; // Флаг нормативного авто-обогащения
  enrichmentOptions?: Gost34EnrichmentOptions; // Выбранные стандарты нормативного обогащения
  standardProfileId?: string; // Идентификатор нормативного профиля (по умолчанию legacy)
}

export type RequirementCategory =
  | 'functional'
  | 'performance'
  | 'security'
  | 'reliability'
  | 'ergonomics'
  | 'technical'
  | 'software'
  | 'organizational';

export interface Gost34RequirementItem {
  id: string;
  code: string; // e.g. "ТР-Ф-01", "ТР-ТТ-02"
  category: RequirementCategory;
  title: string;
  description: string;
  sourceFile?: string; // Имя файла вендорского ТЗ/ФТ/ТТ
  /**
   * Immutable source wording. Templates ignore it; it exists so provenance
   * survives the round trip through the client. See requirements/v2.ts.
   */
  originalText?: string;
  /** Who produced `description` if it is not the original text (e.g. an LLM). */
  normalizedBy?: string;
  stageName?: string;
  stageRole?: string;
  mappedStageId?: string;
  mappedStageName?: string;
  mappedRole?: string;
}

export interface Gost34StageItem {
  id: string;
  order: number;
  name: string;
  role: string;
  hours: number;
  startDate?: string;
  endDate?: string;
  requirements?: string;
}

export interface Gost34RiskItem {
  id: string;
  description: string;
  hours: number;
}

export interface Gost34TableData {
  caption?: string;
  headers: string[];
  rows: (string | number)[][];
}

export interface Gost34Section {
  id: string;
  numStr: string; // e.g., "1", "4.1", "4.2.1"
  title: string;
  paragraphs: string[];
  tables?: Gost34TableData[];
  subsections?: Gost34Section[];
}

export interface Gost34DocumentAST {
  metadata: Gost34DocMetadata;
  sections: Gost34Section[];
  /** Optional so a hand-built AST still compiles; the exporter falls back to legacy. */
  standardProfile?: StandardProfile;
}

/**
 * Raw input payload for GOST 34 document generation
 */
export interface Gost34InputPayload {
  metadata: Gost34DocMetadata;
  standardProfile: StandardProfile;
  systemName: string;
  customerName: string;
  templateName?: string;
  answers?: Record<string, any>;
  stages: Gost34StageItem[];
  risks?: Gost34RiskItem[];
  pmHours?: number;
  totalLaborHours?: number;
  customRequirements?: Gost34RequirementItem[];
  /** Same requirements in the v2 model, with provenance and approval state. */
  requirementsV2?: Gost34RequirementV2[];
  vendorSourceFiles?: string[];
  /** Проектный контекст: источник сведений о системе вместо жёстко заданных значений в шаблонах. */
  projectContext?: ProjectContext;
  /** Результаты оценки применимости нормативных актов (Applicability Engine, PR-05). */
  applicability?: ApplicabilityResult[];
  /** Замечания GOST Validator к набору требований. Не блокирует генерацию. */
  validation?: ValidationReport;
  /** Предварительно рассчитанные или вручную отредактированные связи трассировки (Traceability Engine, PR-07). */
  traceability?: import('./traceability/types').TraceabilityResult;
}
