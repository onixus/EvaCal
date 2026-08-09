/**
 * ProjectContext — модель проектного контекста (Этап 3 плана модернизации).
 *
 * Заменяет жёстко заданные в шаблонах сведения о конкретной системе
 * (стек, инфраструктура, SLA, назначение) на данные, полученные из
 * опросника, расчёта, импортированных документов и ручного ввода.
 *
 * Ключевое правило: если данных нет — поле помечается как требующее
 * уточнения (см. `ContextGap`), а не заполняется выдуманным значением.
 */

/** Откуда получено значение поля контекста. */
export type ContextSource =
  | "questionnaire" // ответы опросника (Calculation.answers)
  | "calculation" // сам расчёт: этапы, риски, трудозатраты, сроки
  | "document" // импортированный вендорский документ
  | "requirement" // согласованное требование
  | "manual" // ручной ввод / override через API
  | "unknown";

/** Провенанс одного поля контекста. */
export interface ContextProvenance {
  /** Путь поля, например `availability.rtoMinutes`. */
  path: string;
  source: ContextSource;
  /** Конкретное основание: ключ ответа опросника, имя файла и т. п. */
  evidence?: string;
}

/** Насколько критично отсутствие данных для выпуска документа. */
export type ContextGapSeverity = "blocking" | "major" | "minor";

/** Незаполненное поле проектного контекста. */
export interface ContextGap {
  path: string;
  /** Человекочитаемое название поля для отображения в документе и UI. */
  label: string;
  severity: ContextGapSeverity;
  /** Подсказка, откуда взять данные. */
  hint?: string;
}

export interface ProjectGoal {
  id: string;
  statement: string;
  source?: ContextSource;
}

export interface GoalCriterion {
  goalId?: string;
  metric: string;
  target?: string;
  measurementMethod?: string;
}

export interface ArchitectureContext {
  /** Например: «клиент-серверная», «микросервисная». */
  style?: string;
  components?: string[];
  externalSystems?: string[];
  notes?: string[];
}

export type IntegrationDirection =
  "inbound" | "outbound" | "bidirectional" | "unknown";

export interface IntegrationContext {
  name: string;
  direction?: IntegrationDirection;
  protocol?: string;
  dataFormat?: string;
  note?: string;
}

export type DeploymentModel = "on-premise" | "cloud" | "hybrid" | "unknown";

export interface InfrastructureContext {
  deploymentModel?: DeploymentModel;
  /** Программные платформы, названные Заказчиком (ОС, СУБД, серверы приложений). */
  platforms?: string[];
  computeResources?: string;
  storage?: string;
  network?: string;
  /** Требование импортозамещения / реестра российского ПО. */
  importSubstitution?: boolean;
}

export interface UserGroup {
  name: string;
  approximateCount?: number;
  description?: string;
}

export interface SystemRole {
  name: string;
  permissions?: string[];
}

export interface AvailabilityRequirements {
  availabilityTargetPercent?: number;
  rtoMinutes?: number;
  rpoMinutes?: number;
  serviceWindow?: string;
}

export interface PerformanceRequirements {
  concurrentUsers?: number;
  peakRequestsPerSecond?: number;
  maxResponseTimeMs?: number;
  dataVolume?: string;
}

export interface SecurityContext {
  personalDataProcessed?: boolean;
  kiiObject?: boolean;
  /** Класс защищённости / уровень защищённости, если определён Заказчиком. */
  securityClass?: string;
  authentication?: string[];
  /** Нормативные акты, применимость которых подтверждена (см. Applicability Engine, PR-05). */
  regulatoryScope?: string[];
}

export interface DataClass {
  name: string;
  sensitivity?: string;
  retention?: string;
  volume?: string;
}

export interface LifecycleContext {
  stages?: string[];
  startDate?: string;
  endDate?: string;
  totalLaborHours?: number;
}

export interface DocumentationRequirement {
  code: string;
  name: string;
  standardReference?: string;
}

/**
 * Проектный контекст. Все поля опциональны: отсутствие данных —
 * законное состояние, фиксируемое в `gaps`.
 */
export interface ProjectContext {
  automationObject?: string;

  systemPurpose?: string;
  goals?: ProjectGoal[];
  measurableGoalCriteria?: GoalCriterion[];

  architecture?: ArchitectureContext;
  integrations?: IntegrationContext[];
  infrastructure?: InfrastructureContext;

  users?: UserGroup[];
  roles?: SystemRole[];

  availability?: AvailabilityRequirements;
  performance?: PerformanceRequirements;
  security?: SecurityContext;

  dataClasses?: DataClass[];

  lifecycle?: LifecycleContext;
  deploymentModel?: DeploymentModel;

  documentationRequirements?: DocumentationRequirement[];

  /** Провенанс заполненных полей. */
  provenance?: ContextProvenance[];
  /** Поля, требующие уточнения у Заказчика. */
  gaps?: ContextGap[];
}

/** Текст-заполнитель для полей, по которым нет данных. */
export const CONTEXT_GAP_PLACEHOLDER = "Требует уточнения у Заказчика";

/** Форматирует незаполненное поле для вставки в документ. */
export function formatGap(label: string): string {
  return `${label}: ${CONTEXT_GAP_PLACEHOLDER}.`;
}
