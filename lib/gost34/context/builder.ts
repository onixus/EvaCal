/**
 * Сборка ProjectContext из доступных источников:
 *
 *   опросник + расчёт + импортированные документы + требования + ручной ввод
 *
 * Правила:
 *  - значение попадает в контекст только если оно явно есть в источнике;
 *  - для каждого заполненного поля фиксируется провенанс;
 *  - для каждого незаполненного значимого поля создаётся ContextGap.
 */

import {
  ArchitectureContext,
  ContextGap,
  ContextGapSeverity,
  ContextProvenance,
  ContextSource,
  DataClass,
  DeploymentModel,
  IntegrationContext,
  InfrastructureContext,
  ProjectContext,
  ProjectGoal,
  SystemRole,
  UserGroup,
} from "./types";
import {
  Gost34RequirementItem,
  Gost34RiskItem,
  Gost34StageItem,
} from "../types";

export interface ProjectContextInput {
  systemName?: string;
  customerName?: string;
  answers?: Record<string, any>;
  stages?: Gost34StageItem[];
  risks?: Gost34RiskItem[];
  requirements?: Gost34RequirementItem[];
  totalLaborHours?: number;
  vendorSourceFiles?: string[];
  /** Ручной ввод: перекрывает всё, что выведено из опросника и расчёта. */
  override?: Partial<ProjectContext>;
}

const TRUE_WORDS = /^(да|yes|true|1|есть|требуется)$/i;
const FALSE_WORDS = /^(нет|no|false|0|не требуется|отсутствует)$/i;

function toBool(value: any): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const v = value.trim();
    if (TRUE_WORDS.test(v)) return true;
    if (FALSE_WORDS.test(v)) return false;
  }
  return undefined;
}

function toNumber(value: any): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const match = value.replace(",", ".").match(/-?\d+(\.\d+)?/);
    if (match) return Number(match[0]);
  }
  return undefined;
}

function toText(value: any): string | undefined {
  if (typeof value === "string") {
    const v = value.trim();
    return v.length > 0 ? v : undefined;
  }
  if (typeof value === "number") return String(value);
  return undefined;
}

/** Разбирает перечисление, введённое одной строкой. */
function toList(value: any): string[] | undefined {
  const text = toText(value);
  if (!text) return undefined;
  const items = text
    .split(/[;\n]|,(?![^(]*\))/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return items.length > 0 ? items : undefined;
}

interface BuildState {
  provenance: ContextProvenance[];
  gaps: ContextGap[];
}

function record(
  state: BuildState,
  path: string,
  source: ContextSource,
  evidence?: string,
) {
  state.provenance.push({ path, source, evidence });
}

function gap(
  state: BuildState,
  path: string,
  label: string,
  severity: ContextGapSeverity,
  hint?: string,
) {
  state.gaps.push({ path, label, severity, hint });
}

/** Ищет первый ответ опросника, ключ которого соответствует шаблону. */
function findAnswer(
  answers: Record<string, any>,
  pattern: RegExp,
): { key: string; value: any } | undefined {
  for (const [key, value] of Object.entries(answers)) {
    if (value === null || value === undefined || value === "") continue;
    if (pattern.test(key)) return { key, value };
  }
  return undefined;
}

export function buildProjectContext(
  input: ProjectContextInput,
): ProjectContext {
  const answers = input.answers || {};
  const stages = input.stages || [];
  const override = input.override || {};
  const state: BuildState = { provenance: [], gaps: [] };

  const ctx: ProjectContext = {};

  // ── Объект автоматизации и назначение ────────────────────────────────
  const objectAnswer = findAnswer(answers, /object|объект|процесс|бизнес/i);
  if (objectAnswer) {
    ctx.automationObject = toText(objectAnswer.value);
    record(state, "automationObject", "questionnaire", objectAnswer.key);
  } else {
    gap(
      state,
      "automationObject",
      "Объект автоматизации",
      "blocking",
      "Опросник: характеристика автоматизируемых процессов Заказчика",
    );
  }

  const purposeAnswer = findAnswer(answers, /purpose|назначен|цель_систем/i);
  if (purposeAnswer) {
    ctx.systemPurpose = toText(purposeAnswer.value);
    record(state, "systemPurpose", "questionnaire", purposeAnswer.key);
  } else {
    gap(
      state,
      "systemPurpose",
      "Назначение системы",
      "blocking",
      "Опросник или согласованные требования Заказчика",
    );
  }

  // ── Цели и измеримые критерии ────────────────────────────────────────
  const goalsAnswer = findAnswer(answers, /goals?|цели/i);
  const goalsList = goalsAnswer ? toList(goalsAnswer.value) : undefined;
  if (goalsList && goalsList.length > 0) {
    ctx.goals = goalsList.map<ProjectGoal>((statement, idx) => ({
      id: `goal-${idx + 1}`,
      statement,
      source: "questionnaire",
    }));
    record(state, "goals", "questionnaire", goalsAnswer!.key);
  } else {
    gap(
      state,
      "goals",
      "Цели создания системы",
      "blocking",
      "Опросник: цели проекта, согласованные с Заказчиком",
    );
  }
  // Измеримые критерии целей задаются только вручную: выводить их из опросника нельзя.
  gap(
    state,
    "measurableGoalCriteria",
    "Измеримые критерии достижения целей",
    "major",
    "Согласуются с Заказчиком при утверждении целей",
  );

  // ── Пользователи и роли ──────────────────────────────────────────────
  const usersAnswer = findAnswer(answers, /users?_?count|пользоват/i);
  const usersCount = usersAnswer ? toNumber(usersAnswer.value) : undefined;
  if (usersCount !== undefined) {
    const group: UserGroup = {
      name: "Пользователи системы",
      approximateCount: usersCount,
    };
    ctx.users = [group];
    record(state, "users", "questionnaire", usersAnswer!.key);
    gap(
      state,
      "users[].composition",
      "Состав групп пользователей",
      "major",
      "Известна только общая численность пользователей",
    );
  } else {
    gap(
      state,
      "users",
      "Группы пользователей",
      "major",
      "Опросник: категории и численность пользователей",
    );
  }

  const rolesAnswer = findAnswer(answers, /roles?|рол/i);
  const rolesList = rolesAnswer ? toList(rolesAnswer.value) : undefined;
  if (rolesList) {
    ctx.roles = rolesList.map<SystemRole>((name) => ({ name }));
    record(state, "roles", "questionnaire", rolesAnswer!.key);
  } else {
    gap(
      state,
      "roles",
      "Ролевая модель системы",
      "major",
      "Опросник: перечень ролей и их полномочий",
    );
  }

  // ── Архитектура и интеграции ─────────────────────────────────────────
  const architecture: ArchitectureContext = {};
  const notes: string[] = [];

  const styleAnswer = findAnswer(answers, /architect|архитектур/i);
  if (styleAnswer) {
    architecture.style = toText(styleAnswer.value);
    record(state, "architecture.style", "questionnaire", styleAnswer.key);
  } else {
    gap(
      state,
      "architecture.style",
      "Архитектура системы",
      "major",
      "Опросник или проектные решения Заказчика",
    );
  }

  const screensAnswer = findAnswer(answers, /screens?_?count|экран|форм/i);
  const screensCount = screensAnswer
    ? toNumber(screensAnswer.value)
    : undefined;
  if (screensCount !== undefined) {
    notes.push(`Количество экранных форм по опроснику: ${screensCount}.`);
    record(state, "architecture.notes", "questionnaire", screensAnswer!.key);
  }

  const complexityAnswer = findAnswer(answers, /complexity|сложност/i);
  if (complexityAnswer) {
    const complexity = toText(complexityAnswer.value);
    if (complexity) {
      notes.push(`Оценка сложности решения по опроснику: ${complexity}.`);
      record(
        state,
        "architecture.notes",
        "questionnaire",
        complexityAnswer.key,
      );
    }
  }

  if (notes.length > 0) architecture.notes = notes;
  if (Object.keys(architecture).length > 0) ctx.architecture = architecture;

  const integrationsAnswer = findAnswer(
    answers,
    /integrations?|интеграц|смежн/i,
  );
  const integrationsList = integrationsAnswer
    ? toList(integrationsAnswer.value)
    : undefined;
  const integrationsCount = integrationsAnswer
    ? toNumber(integrationsAnswer.value)
    : undefined;
  const namedIntegrations = integrationsList?.filter(
    (item) => !/^\d+$/.test(item),
  );

  if (namedIntegrations && namedIntegrations.length > 0) {
    ctx.integrations = namedIntegrations.map<IntegrationContext>((name) => ({
      name,
      direction: "unknown",
    }));
    record(state, "integrations", "questionnaire", integrationsAnswer!.key);
  } else if (integrationsCount !== undefined && integrationsCount > 0) {
    // Известно только количество: перечень смежных систем остаётся к уточнению.
    architecture.notes = [
      ...(architecture.notes || []),
      `Заявленное количество интеграций: ${integrationsCount}.`,
    ];
    ctx.architecture = architecture;
    record(
      state,
      "architecture.notes",
      "questionnaire",
      integrationsAnswer!.key,
    );
    gap(
      state,
      "integrations",
      "Перечень интегрируемых систем",
      "major",
      "В опроснике указано только количество интеграций",
    );
  } else {
    gap(
      state,
      "integrations",
      "Интеграции со смежными системами",
      "major",
      "Опросник: перечень смежных систем и протоколов обмена",
    );
  }

  // ── Инфраструктура ───────────────────────────────────────────────────
  const infrastructure: InfrastructureContext = {};

  const deploymentAnswer = findAnswer(
    answers,
    /deployment|размещен|облак|cloud|хостинг/i,
  );
  const deploymentText = deploymentAnswer
    ? toText(deploymentAnswer.value)?.toLowerCase()
    : undefined;
  let deploymentModel: DeploymentModel | undefined;
  if (deploymentText) {
    if (/гибрид|hybrid/.test(deploymentText)) deploymentModel = "hybrid";
    else if (/облак|cloud/.test(deploymentText)) deploymentModel = "cloud";
    else if (/локальн|on-?prem|собствен|заказчик/.test(deploymentText))
      deploymentModel = "on-premise";
  }
  if (deploymentModel) {
    infrastructure.deploymentModel = deploymentModel;
    ctx.deploymentModel = deploymentModel;
    record(state, "deploymentModel", "questionnaire", deploymentAnswer!.key);
  } else {
    gap(
      state,
      "deploymentModel",
      "Модель размещения системы",
      "major",
      "Опросник: локальное размещение, облако или гибрид",
    );
  }

  const platformsAnswer = findAnswer(
    answers,
    /platform|платформ|стек|субд|операционн|os_/i,
  );
  const platformsList = platformsAnswer
    ? toList(platformsAnswer.value)
    : undefined;
  if (platformsList) {
    infrastructure.platforms = platformsList;
    record(
      state,
      "infrastructure.platforms",
      "questionnaire",
      platformsAnswer!.key,
    );
  } else {
    gap(
      state,
      "infrastructure.platforms",
      "Программные платформы",
      "major",
      "Технические требования Заказчика; выбор стека не определяется исполнителем в одностороннем порядке",
    );
  }

  const resourcesAnswer = findAnswer(answers, /cpu|ram|ресурс|мощност|сервер/i);
  if (resourcesAnswer) {
    infrastructure.computeResources = toText(resourcesAnswer.value);
    record(
      state,
      "infrastructure.computeResources",
      "questionnaire",
      resourcesAnswer.key,
    );
  } else {
    gap(
      state,
      "infrastructure.computeResources",
      "Требования к вычислительным ресурсам",
      "major",
      "Рассчитываются на стадии эскизного проекта либо задаются Заказчиком",
    );
  }

  const importAnswer = findAnswer(
    answers,
    /импортозамещ|реестр|отечествен|188/i,
  );
  const importValue = importAnswer ? toBool(importAnswer.value) : undefined;
  if (importValue !== undefined) {
    infrastructure.importSubstitution = importValue;
    record(
      state,
      "infrastructure.importSubstitution",
      "questionnaire",
      importAnswer!.key,
    );
  }

  if (Object.keys(infrastructure).length > 0)
    ctx.infrastructure = infrastructure;

  // ── Доступность и производительность ─────────────────────────────────
  const availabilityAnswer = findAnswer(
    answers,
    /availability|доступност|sla/i,
  );
  const rtoAnswer = findAnswer(answers, /rto|восстановлен/i);
  const rpoAnswer = findAnswer(answers, /rpo|потер[яи] данных/i);
  const availability: ProjectContext["availability"] = {};
  if (availabilityAnswer) {
    availability.availabilityTargetPercent = toNumber(availabilityAnswer.value);
    record(
      state,
      "availability.availabilityTargetPercent",
      "questionnaire",
      availabilityAnswer.key,
    );
  }
  if (rtoAnswer) {
    availability.rtoMinutes = toNumber(rtoAnswer.value);
    record(state, "availability.rtoMinutes", "questionnaire", rtoAnswer.key);
  }
  if (rpoAnswer) {
    availability.rpoMinutes = toNumber(rpoAnswer.value);
    record(state, "availability.rpoMinutes", "questionnaire", rpoAnswer.key);
  }
  if (Object.keys(availability).length > 0) {
    ctx.availability = availability;
  } else {
    gap(
      state,
      "availability",
      "Требования к надёжности (доступность, RTO, RPO)",
      "blocking",
      "Согласуются с Заказчиком; универсальные значения не применяются",
    );
  }

  const performance: ProjectContext["performance"] = {};
  const concurrentAnswer = findAnswer(answers, /concurrent|одновремен/i);
  if (concurrentAnswer) {
    performance.concurrentUsers = toNumber(concurrentAnswer.value);
    record(
      state,
      "performance.concurrentUsers",
      "questionnaire",
      concurrentAnswer.key,
    );
  }
  const responseAnswer = findAnswer(answers, /response|отклик|быстродейств/i);
  if (responseAnswer) {
    performance.maxResponseTimeMs = toNumber(responseAnswer.value);
    record(
      state,
      "performance.maxResponseTimeMs",
      "questionnaire",
      responseAnswer.key,
    );
  }
  const volumeAnswer = findAnswer(answers, /volume|объ[её]м данных/i);
  if (volumeAnswer) {
    performance.dataVolume = toText(volumeAnswer.value);
    record(state, "performance.dataVolume", "questionnaire", volumeAnswer.key);
  }
  if (Object.keys(performance).length > 0) {
    ctx.performance = performance;
  } else {
    gap(
      state,
      "performance",
      "Требования к производительности",
      "major",
      "Опросник: одновременные пользователи, время отклика, объёмы данных",
    );
  }

  // ── Безопасность и классы данных ─────────────────────────────────────
  const security: ProjectContext["security"] = {};
  const pdnAnswer = findAnswer(answers, /персональн|пдн|152/i);
  const pdnValue = pdnAnswer ? toBool(pdnAnswer.value) : undefined;
  if (pdnValue !== undefined) {
    security.personalDataProcessed = pdnValue;
    record(
      state,
      "security.personalDataProcessed",
      "questionnaire",
      pdnAnswer!.key,
    );
  }
  const kiiAnswer = findAnswer(answers, /кии|187|значимый объект/i);
  const kiiValue = kiiAnswer ? toBool(kiiAnswer.value) : undefined;
  if (kiiValue !== undefined) {
    security.kiiObject = kiiValue;
    record(state, "security.kiiObject", "questionnaire", kiiAnswer!.key);
  }
  const securityClassAnswer = findAnswer(answers, /класс защищ|уровень защищ/i);
  if (securityClassAnswer) {
    security.securityClass = toText(securityClassAnswer.value);
    record(
      state,
      "security.securityClass",
      "questionnaire",
      securityClassAnswer.key,
    );
  }
  const authAnswer = findAnswer(answers, /аутентифик|авториз|sso|ldap/i);
  const authList = authAnswer ? toList(authAnswer.value) : undefined;
  if (authList) {
    security.authentication = authList;
    record(state, "security.authentication", "questionnaire", authAnswer!.key);
  }
  if (Object.keys(security).length > 0) {
    ctx.security = security;
  } else {
    gap(
      state,
      "security",
      "Требования к защите информации",
      "blocking",
      "Определяются по результатам анализа применимости (обработка ПДн, КИИ, отраслевые требования)",
    );
  }

  const dataAnswer = findAnswer(
    answers,
    /классы данных|data_?class|состав данных/i,
  );
  const dataList = dataAnswer ? toList(dataAnswer.value) : undefined;
  if (dataList) {
    ctx.dataClasses = dataList.map<DataClass>((name) => ({ name }));
    record(state, "dataClasses", "questionnaire", dataAnswer!.key);
  } else {
    gap(
      state,
      "dataClasses",
      "Классы обрабатываемых данных",
      "major",
      "Опросник или обследование объекта автоматизации",
    );
  }

  // ── Жизненный цикл (из расчёта) ──────────────────────────────────────
  if (stages.length > 0) {
    ctx.lifecycle = {
      stages: stages.map((s) => s.name),
      startDate: stages[0]?.startDate,
      endDate: stages[stages.length - 1]?.endDate,
      totalLaborHours: input.totalLaborHours,
    };
    record(state, "lifecycle", "calculation", "stages");
  } else {
    gap(
      state,
      "lifecycle",
      "Состав стадий и этапов работ",
      "blocking",
      "Расчёт трудозатрат EvaCal",
    );
  }

  // ── Ручной ввод перекрывает выведенные значения ──────────────────────
  const merged: ProjectContext = { ...ctx, ...stripMeta(override) };

  const overriddenPaths = new Set(Object.keys(stripMeta(override)));
  for (const path of overriddenPaths) {
    record(state, path, "manual", "override");
  }

  merged.provenance = [...state.provenance, ...(override.provenance || [])];
  merged.gaps = [
    ...state.gaps.filter((g) => !overriddenPaths.has(g.path.split(/[.[]/)[0])),
    ...(override.gaps || []),
  ];

  return merged;
}

function stripMeta(override: Partial<ProjectContext>): Partial<ProjectContext> {
  const { provenance, gaps, ...rest } = override;
  return rest;
}

/** Есть ли блокирующие пробелы, из-за которых документ нельзя считать готовым. */
export function hasBlockingGaps(context: ProjectContext): boolean {
  return (context.gaps || []).some((g) => g.severity === "blocking");
}
