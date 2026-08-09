import type { ProjectContext } from "../context/types";
import type { ApplicabilityRule, Evidence, ApplicabilityStatus } from "./types";

/** Вспомогательная функция для проверки наличия нормативного акта в scope. */
function inRegulatoryScope(context: ProjectContext, ids: string[]): boolean {
  if (!context.security?.regulatoryScope) return false;
  return context.security.regulatoryScope.some((s) =>
    ids.some((id) => s.toLowerCase().includes(id.toLowerCase())),
  );
}

/** Собирает общий текст проекта для анализа ключевых слов предметной области. */
function getProjectDomainCorpus(context: ProjectContext): string {
  const parts: string[] = [];
  if (context.automationObject) parts.push(context.automationObject);
  if (context.systemPurpose) parts.push(context.systemPurpose);
  if (context.goals) parts.push(...context.goals.map((g) => g.statement));
  if (context.architecture?.notes) parts.push(...context.architecture.notes);
  if (context.architecture?.components)
    parts.push(...context.architecture.components);
  if (context.security?.securityClass)
    parts.push(context.security.securityClass);
  return parts.join(" ");
}

export const APPLICABILITY_RULES: ApplicabilityRule[] = [
  // 1. Приказ ФСТЭК России № 21 (ИСПДн)
  {
    id: "fstek_21",
    title: "Приказ ФСТЭК России № 21 (Защита ИСПДн)",
    category: "security",
    evaluate: (context) => {
      const evidence: Evidence[] = [];
      const reasons: string[] = [];

      if (
        inRegulatoryScope(context, ["fstek_21", "фстэк_21", "ispdn", "испдн"])
      ) {
        evidence.push({
          source: "security.regulatoryScope",
          details:
            "Приказ ФСТЭК № 21 явно указан в перечне нормативных актов системы",
          value: context.security?.regulatoryScope,
        });
        reasons.push("Стандарт явно включён в нормативный скоуп проекта.");
        return { status: "APPLICABLE", reasons, evidence, confidence: 1.0 };
      }

      if (context.security?.personalDataProcessed === true) {
        evidence.push({
          source: "security.personalDataProcessed",
          details: "В системе подтверждена обработка персональных данных",
          value: true,
        });
        reasons.push(
          "Система обрабатывает персональные данные, требуется выполнение мер защиты ИСПДн по Приказу ФСТЭК № 21.",
        );
        return { status: "APPLICABLE", reasons, evidence, confidence: 0.95 };
      }

      // Проверка классов данных на наличие ПДн
      const pdDataClass = context.dataClasses?.find((d) =>
        /персональн|пдн|паспорт|фио|клиент|пользовател|снилс|инн/i.test(
          `${d.name} ${d.sensitivity || ""}`,
        ),
      );
      if (pdDataClass) {
        evidence.push({
          source: "dataClasses",
          details: `Обнаружен класс данных, содержащий персональные данные: «${pdDataClass.name}»`,
          value: pdDataClass,
        });
        reasons.push(
          "В составе обрабатываемых данных идентифицированы персональные данные.",
        );
        return { status: "APPLICABLE", reasons, evidence, confidence: 0.9 };
      }

      if (context.security?.personalDataProcessed === false) {
        evidence.push({
          source: "security.personalDataProcessed",
          details: "Обработка персональных данных явно отключена",
          value: false,
        });
        reasons.push("В системе явно не обрабатываются персональные данные.");
        return {
          status: "NOT_APPLICABLE",
          reasons,
          evidence,
          confidence: 0.95,
        };
      }

      reasons.push(
        "Наличие персональных данных не определено. Требуется подтверждение у Заказчика.",
      );
      return { status: "UNKNOWN", reasons, evidence, confidence: 0.0 };
    },
  },

  // 2. 152-ФЗ / 242-ФЗ (Локализация баз ПДн в РФ)
  {
    id: "fz_152",
    title: "152-ФЗ / 242-ФЗ (Локализация баз данных персональных данных в РФ)",
    category: "security",
    evaluate: (context) => {
      const evidence: Evidence[] = [];
      const reasons: string[] = [];

      if (
        inRegulatoryScope(context, ["fz_152", "152-фз", "152_fz", "242-фз"])
      ) {
        evidence.push({
          source: "security.regulatoryScope",
          details:
            "152-ФЗ / 242-ФЗ явно указан в перечне нормативных актов системы",
          value: context.security?.regulatoryScope,
        });
        reasons.push("Закон 152-ФЗ включён в нормативный скоуп проекта.");
        return { status: "APPLICABLE", reasons, evidence, confidence: 1.0 };
      }

      if (context.security?.personalDataProcessed === true) {
        evidence.push({
          source: "security.personalDataProcessed",
          details:
            "В системе подтверждена обработка персональных данных граждан РФ",
          value: true,
        });
        reasons.push(
          "При обработке персональных данных граждан РФ закон требует их обязательной локализации на территории РФ.",
        );
        return { status: "APPLICABLE", reasons, evidence, confidence: 0.95 };
      }

      const pdDataClass = context.dataClasses?.find((d) =>
        /персональн|пдн|паспорт|фио|клиент|пользовател/i.test(
          `${d.name} ${d.sensitivity || ""}`,
        ),
      );
      if (pdDataClass) {
        evidence.push({
          source: "dataClasses",
          details: `Обнаружен класс данных, содержащий персональные данные: «${pdDataClass.name}»`,
          value: pdDataClass,
        });
        reasons.push(
          "В системе присутствуют персональные данные, подпадающие под 152-ФЗ / 242-ФЗ.",
        );
        return { status: "APPLICABLE", reasons, evidence, confidence: 0.9 };
      }

      if (context.security?.personalDataProcessed === false) {
        evidence.push({
          source: "security.personalDataProcessed",
          details: "Обработка персональных данных явно отсутствует",
          value: false,
        });
        reasons.push("Персональные данные не обрабатываются.");
        return {
          status: "NOT_APPLICABLE",
          reasons,
          evidence,
          confidence: 0.95,
        };
      }

      reasons.push(
        "Не указано, обрабатываются ли персональные данные. Применимость 152-ФЗ требует уточнения.",
      );
      return { status: "UNKNOWN", reasons, evidence, confidence: 0.0 };
    },
  },

  // 3. 187-ФЗ (О безопасности КИИ РФ)
  {
    id: "fz_187_kii",
    title: "187-ФЗ «О безопасности КИИ РФ»",
    category: "security",
    evaluate: (context) => {
      const evidence: Evidence[] = [];
      const reasons: string[] = [];

      if (
        inRegulatoryScope(context, ["fz_187", "187-фз", "187_fz", "kii", "кии"])
      ) {
        evidence.push({
          source: "security.regulatoryScope",
          details: "187-ФЗ явно указан в нормативном скоупе проекта",
          value: context.security?.regulatoryScope,
        });
        reasons.push("187-ФЗ включён в нормативный скоуп.");
        return { status: "APPLICABLE", reasons, evidence, confidence: 1.0 };
      }

      if (context.security?.kiiObject === true) {
        evidence.push({
          source: "security.kiiObject",
          details: "Система отнесена к объектам КИИ РФ",
          value: true,
        });
        reasons.push(
          "Система является объектом критической информационной инфраструктуры по 187-ФЗ.",
        );
        return { status: "APPLICABLE", reasons, evidence, confidence: 0.95 };
      }

      const corpus = getProjectDomainCorpus(context);
      if (
        /кии|критическ\w*\s+информационн|значим\w*\s+объект|энергетик\w*|транспорт\w*\s+инфраструктур|оборонн\w*|здравоохран\w*\s+инфраструктур/i.test(
          corpus,
        )
      ) {
        evidence.push({
          source: "projectDomain",
          details:
            "Контекст системы указывает на принадлежность к субъектам/сферам КИИ",
        });
        reasons.push(
          "Контекст объекта автоматизации содержит признаки критической информационной инфраструктуры.",
        );
        return { status: "APPLICABLE", reasons, evidence, confidence: 0.85 };
      }

      if (context.security?.kiiObject === false) {
        evidence.push({
          source: "security.kiiObject",
          details: "Принадлежность к КИИ явно отклонена",
          value: false,
        });
        reasons.push("Система явно не является объектом КИИ.");
        return {
          status: "NOT_APPLICABLE",
          reasons,
          evidence,
          confidence: 0.95,
        };
      }

      reasons.push(
        "Статус объекта КИИ не определён. Требуется процедура категорирования.",
      );
      return { status: "UNKNOWN", reasons, evidence, confidence: 0.0 };
    },
  },

  // 4. Приказ ФСТЭК России № 239 (Безопасность объектов КИИ)
  {
    id: "fstek_239",
    title: "Приказ ФСТЭК России № 239 (Безопасность объектов КИИ)",
    category: "security",
    evaluate: (context) => {
      const evidence: Evidence[] = [];
      const reasons: string[] = [];

      if (inRegulatoryScope(context, ["fstek_239", "фстэк_239", "fstek239"])) {
        evidence.push({
          source: "security.regulatoryScope",
          details: "Приказ ФСТЭК № 239 явно указан в скоупе проекта",
          value: context.security?.regulatoryScope,
        });
        reasons.push("Приказ ФСТЭК № 239 включён в нормативный скоуп.");
        return { status: "APPLICABLE", reasons, evidence, confidence: 1.0 };
      }

      if (context.security?.kiiObject === true) {
        evidence.push({
          source: "security.kiiObject",
          details: "Система отнесена к объектам КИИ РФ",
          value: true,
        });
        reasons.push(
          "Для объектов КИИ обязателен состав мер защиты по Приказу ФСТЭК № 239 для категорий значимости 1, 2, 3.",
        );
        return { status: "APPLICABLE", reasons, evidence, confidence: 0.95 };
      }

      if (context.security?.kiiObject === false) {
        evidence.push({
          source: "security.kiiObject",
          details: "Система не относится к КИИ",
          value: false,
        });
        reasons.push("Система не является объектом КИИ.");
        return {
          status: "NOT_APPLICABLE",
          reasons,
          evidence,
          confidence: 0.95,
        };
      }

      reasons.push(
        "Статус значимого объекта КИИ не определён. Требуется подтверждение.",
      );
      return { status: "UNKNOWN", reasons, evidence, confidence: 0.0 };
    },
  },

  // 5. Приказ ФСТЭК России № 117 + ГОСТ Р 56939-2016 (Безопасная разработка ПО)
  {
    id: "fstek_117",
    title:
      "Приказ ФСТЭК России № 117 + ГОСТ Р 56939-2016 (Безопасная разработка ПО)",
    category: "security",
    evaluate: (context) => {
      const evidence: Evidence[] = [];
      const reasons: string[] = [];

      if (
        inRegulatoryScope(context, [
          "fstek_117",
          "фстэк_117",
          "56939",
          "secure_dev",
        ])
      ) {
        evidence.push({
          source: "security.regulatoryScope",
          details: "Приказ ФСТЭК № 117 / ГОСТ Р 56939 явно включён в скоуп",
          value: context.security?.regulatoryScope,
        });
        reasons.push(
          "Требования к безопасной разработке включены в скоуп проекта.",
        );
        return { status: "APPLICABLE", reasons, evidence, confidence: 1.0 };
      }

      const isProtectedSystem =
        context.security?.kiiObject === true ||
        context.security?.personalDataProcessed === true;
      const hasCustomDevelopment =
        (context.lifecycle?.stages && context.lifecycle.stages.length > 0) ||
        (context.lifecycle?.totalLaborHours &&
          context.lifecycle.totalLaborHours > 0);

      if (isProtectedSystem && hasCustomDevelopment) {
        evidence.push({
          source: "lifecycle + security",
          details:
            "Заказная разработка ПО для защищаемой информационной системы (КИИ / ИСПДн)",
        });
        reasons.push(
          "Для разрабатываемого ПО защищаемых систем обязательно применение практик безопасной разработки (SAST/DAST/SCA) по Приказу ФСТЭК № 117.",
        );
        return { status: "APPLICABLE", reasons, evidence, confidence: 0.85 };
      }

      reasons.push(
        "Применимость обязательных процедур безопасной разработки по ФСТЭК № 117 требует согласования с Заказчиком.",
      );
      return { status: "UNKNOWN", reasons, evidence, confidence: 0.0 };
    },
  },

  // 6. 188-ФЗ (Реестр отечественного ПО / Импортозамещение)
  {
    id: "fz_188_reestr",
    title: "188-ФЗ (Единый реестр российского ПО / импортозамещение)",
    category: "technical",
    evaluate: (context) => {
      const evidence: Evidence[] = [];
      const reasons: string[] = [];

      if (
        inRegulatoryScope(context, [
          "fz_188",
          "188-фз",
          "188_fz",
          "reestr",
          "реестр",
        ])
      ) {
        evidence.push({
          source: "security.regulatoryScope",
          details: "188-ФЗ явно указан в скоупе проекта",
          value: context.security?.regulatoryScope,
        });
        reasons.push("188-ФЗ включён в скоуп.");
        return { status: "APPLICABLE", reasons, evidence, confidence: 1.0 };
      }

      if (context.infrastructure?.importSubstitution === true) {
        evidence.push({
          source: "infrastructure.importSubstitution",
          details:
            "Задано явное требование импортозамещения и совместимости с Реестром российского ПО",
          value: true,
        });
        reasons.push(
          "В проектном контексте зафиксировано требование совместимости с отечественным стеком по 188-ФЗ.",
        );
        return { status: "APPLICABLE", reasons, evidence, confidence: 0.95 };
      }

      const ruPlatforms = context.infrastructure?.platforms?.filter((p) =>
        /astra|alt\s*linux|альт|red\s*os|redos|ред\s*ос|postgres\s*pro|роса|базальт|эльбрус|кибербэкап/i.test(
          p,
        ),
      );
      if (ruPlatforms && ruPlatforms.length > 0) {
        evidence.push({
          source: "infrastructure.platforms",
          details: `Указаны отечественные платформенные компоненты: ${ruPlatforms.join(", ")}`,
          value: ruPlatforms,
        });
        reasons.push(
          "Инфраструктура системы строится на программном обеспечении из Единого реестра российского ПО.",
        );
        return { status: "APPLICABLE", reasons, evidence, confidence: 0.9 };
      }

      if (context.infrastructure?.importSubstitution === false) {
        evidence.push({
          source: "infrastructure.importSubstitution",
          details: "Требование импортозамещения явно отключено",
          value: false,
        });
        reasons.push("Требования импортозамещения к системе не предъявляются.");
        return {
          status: "NOT_APPLICABLE",
          reasons,
          evidence,
          confidence: 0.95,
        };
      }

      reasons.push(
        "Не определено, входит ли система в контур импортозамещения по 188-ФЗ.",
      );
      return { status: "UNKNOWN", reasons, evidence, confidence: 0.0 };
    },
  },

  // 7. ГОСТ Р 57580.1-2017 / СТО БР ИББС (Безопасность финансовых операций)
  {
    id: "gost_57580",
    title:
      "ГОСТ Р 57580.1-2017 / СТО БР ИББС (Безопасность финансовых операций)",
    category: "security",
    evaluate: (context) => {
      const evidence: Evidence[] = [];
      const reasons: string[] = [];

      if (
        inRegulatoryScope(context, [
          "57580",
          "gost_57580",
          "сто бр",
          "ibbs",
          "иббс",
        ])
      ) {
        evidence.push({
          source: "security.regulatoryScope",
          details: "ГОСТ Р 57580.1-2017 включён в скоуп проекта",
          value: context.security?.regulatoryScope,
        });
        reasons.push("ГОСТ Р 57580.1-2017 включён в нормативный скоуп.");
        return { status: "APPLICABLE", reasons, evidence, confidence: 1.0 };
      }

      const corpus = getProjectDomainCorpus(context);
      if (
        /банк\w*|кредитн\w*\s+организаци|финансов\w*\s+организаци|эквайринг|дбо|платежн\w*\s+систем/i.test(
          corpus,
        )
      ) {
        evidence.push({
          source: "projectDomain",
          details:
            "В описании объекта или целей автоматизации идентифицирована финансовая/банковская сфера",
        });
        reasons.push(
          "Система осуществляет обработку финансовых операций или создается для финансовой организации.",
        );
        return { status: "APPLICABLE", reasons, evidence, confidence: 0.85 };
      }

      reasons.push(
        "Принадлежность системы к сфере финансовых (банковских) операций не подтверждена.",
      );
      return { status: "UNKNOWN", reasons, evidence, confidence: 0.0 };
    },
  },

  // 8. Положение Банка России № 683-П (Кредитные организации)
  {
    id: "cb_683p",
    title:
      "Положение Банка России № 683-П (Безопасность ПО кредитных организаций)",
    category: "security",
    evaluate: (context) => {
      const evidence: Evidence[] = [];
      const reasons: string[] = [];

      if (inRegulatoryScope(context, ["683-п", "683_p", "cb_683p", "683п"])) {
        evidence.push({
          source: "security.regulatoryScope",
          details: "Положение ЦБ РФ № 683-П указано в скоупе проекта",
          value: context.security?.regulatoryScope,
        });
        reasons.push(
          "Положение Банка России № 683-П включено в нормативный скоуп.",
        );
        return { status: "APPLICABLE", reasons, evidence, confidence: 1.0 };
      }

      const corpus = getProjectDomainCorpus(context);
      if (/кредитн\w*\s+организаци|банк\w*/i.test(corpus)) {
        evidence.push({
          source: "projectDomain",
          details: "Обнаружены признаки кредитной организации (банка)",
        });
        reasons.push(
          "Заказчик или объект автоматизации является кредитной организацией.",
        );
        return { status: "APPLICABLE", reasons, evidence, confidence: 0.85 };
      }

      reasons.push("Статус кредитной организации не подтверждён.");
      return { status: "UNKNOWN", reasons, evidence, confidence: 0.0 };
    },
  },

  // 9. Положение Банка России № 757-П (НФО)
  {
    id: "cb_757p",
    title: "Положение Банка России № 757-П (Безопасность НФО)",
    category: "security",
    evaluate: (context) => {
      const evidence: Evidence[] = [];
      const reasons: string[] = [];

      if (inRegulatoryScope(context, ["757-п", "757_p", "cb_757p", "757п"])) {
        evidence.push({
          source: "security.regulatoryScope",
          details: "Положение ЦБ РФ № 757-П указано в скоупе проекта",
          value: context.security?.regulatoryScope,
        });
        reasons.push(
          "Положение Банка России № 757-П включено в нормативный скоуп.",
        );
        return { status: "APPLICABLE", reasons, evidence, confidence: 1.0 };
      }

      const corpus = getProjectDomainCorpus(context);
      if (
        /нфо|некредитн\w*\s+финансов|страхов\w*\s+компан|брокер|микрофинанс|мфо|негосударственн\w*\s+пенсионн|депозитари/i.test(
          corpus,
        )
      ) {
        evidence.push({
          source: "projectDomain",
          details:
            "Обнаружены признаки некредитной финансовой организации (НФО)",
        });
        reasons.push(
          "Организация относится к некредитным финансовым организациям (НФО).",
        );
        return { status: "APPLICABLE", reasons, evidence, confidence: 0.85 };
      }

      reasons.push(
        "Принадлежность к некредитным финансовым организациям не подтверждена.",
      );
      return { status: "UNKNOWN", reasons, evidence, confidence: 0.0 };
    },
  },

  // 10. Положение Банка России № 719-П (Антифрод и электронная подпись)
  {
    id: "cb_719p",
    title: "Положение Банка России № 719-П (Антифрод и электронная подпись)",
    category: "security",
    evaluate: (context) => {
      const evidence: Evidence[] = [];
      const reasons: string[] = [];

      if (inRegulatoryScope(context, ["719-п", "719_p", "cb_719p", "719п"])) {
        evidence.push({
          source: "security.regulatoryScope",
          details: "Положение ЦБ РФ № 719-П указано в скоупе проекта",
          value: context.security?.regulatoryScope,
        });
        reasons.push(
          "Положение Банка России № 719-П включено в нормативный скоуп.",
        );
        return { status: "APPLICABLE", reasons, evidence, confidence: 1.0 };
      }

      const corpus = getProjectDomainCorpus(context);
      if (
        /антифрод|электронн\w*\s+подпис|скзи|двухуровнев\w*\s+журналир|платежн\w*\s+распоряжен|платежн\w*\s+поручен/i.test(
          corpus,
        )
      ) {
        evidence.push({
          source: "projectDomain",
          details:
            "Обнаружены требования к антифрод-мониторингу, электронным подписям или финансовым транзакциям",
        });
        reasons.push(
          "В системе предусмотрена обработка электронных платежных сообщений или применение СКЗИ/ЭП по 719-П.",
        );
        return { status: "APPLICABLE", reasons, evidence, confidence: 0.85 };
      }

      reasons.push(
        "Необходимость процедур антифрода и требований 719-П не подтверждена.",
      );
      return { status: "UNKNOWN", reasons, evidence, confidence: 0.0 };
    },
  },

  // 11. Приказ ФСБ России № 282 (ГосСОПКА / НКЦКИ)
  {
    id: "fsb_282_gossopka",
    title: "Приказ ФСБ России № 282 (Взаимодействие с ГосСОПКА / НКЦКИ)",
    category: "security",
    evaluate: (context) => {
      const evidence: Evidence[] = [];
      const reasons: string[] = [];

      if (
        inRegulatoryScope(context, [
          "fsb_282",
          "фсб_282",
          "gossopka",
          "госсопка",
          "нкцки",
        ])
      ) {
        evidence.push({
          source: "security.regulatoryScope",
          details:
            "Взаимодействие с ГосСОПКА по Приказу ФСБ № 282 включено в скоуп проекта",
          value: context.security?.regulatoryScope,
        });
        reasons.push(
          "Требования взаимодействия с ГосСОПКА включены в нормативный скоуп.",
        );
        return { status: "APPLICABLE", reasons, evidence, confidence: 1.0 };
      }

      if (context.security?.kiiObject === true) {
        evidence.push({
          source: "security.kiiObject",
          details:
            "Субъекты КИИ обязаны передавать данные об инцидентах ИБ в ГосСОПКА (Приказ ФСБ № 282)",
          value: true,
        });
        reasons.push(
          "Для объектов КИИ передача сведений об инцидентах в НКЦКИ / ГосСОПКА обязательна по закону.",
        );
        return { status: "APPLICABLE", reasons, evidence, confidence: 0.9 };
      }

      const corpus = getProjectDomainCorpus(context);
      if (/госсопка|нкцки|инцидент\w*\s+иб/i.test(corpus)) {
        evidence.push({
          source: "projectDomain",
          details: "В контексте системы упоминаются ГосСОПКА / НКЦКИ",
        });
        reasons.push("Идентифицирована необходимость информирования ГосСОПКА.");
        return { status: "APPLICABLE", reasons, evidence, confidence: 0.85 };
      }

      if (context.security?.kiiObject === false) {
        evidence.push({
          source: "security.kiiObject",
          details: "Система не относится к КИИ",
          value: false,
        });
        reasons.push("Обязанность взаимодействия с ГосСОПКА отсутствует.");
        return {
          status: "NOT_APPLICABLE",
          reasons,
          evidence,
          confidence: 0.85,
        };
      }

      reasons.push("Обязанность передачи сведений в ГосСОПКА не определена.");
      return { status: "UNKNOWN", reasons, evidence, confidence: 0.0 };
    },
  },

  // 12. SLA 99.9% (Надёжность и непрерывность)
  {
    id: "sla_999",
    title:
      "SLA 99.9% (Непрерывность функционирования и RTO ≤ 15 мин, RPO ≤ 5 мин)",
    category: "reliability",
    evaluate: (context) => {
      const evidence: Evidence[] = [];
      const reasons: string[] = [];

      const target = context.availability?.availabilityTargetPercent;
      const rto = context.availability?.rtoMinutes;
      const rpo = context.availability?.rpoMinutes;

      if (target !== undefined && target >= 99.9) {
        evidence.push({
          source: "availability.availabilityTargetPercent",
          details: `Задан целевой уровень доступности ${target}%`,
          value: target,
        });
        reasons.push(
          `Зафиксирован высокий целевой показатель доступности: ${target}%.`,
        );
        return { status: "APPLICABLE", reasons, evidence, confidence: 0.95 };
      }

      if (rto !== undefined && rto <= 15) {
        evidence.push({
          source: "availability.rtoMinutes",
          details: `Задано допустимое время восстановления RTO ≤ ${rto} мин`,
          value: rto,
        });
        reasons.push(
          `Установлено жесткое требование к восстановлению после сбоев (RTO ≤ ${rto} мин).`,
        );
        return { status: "APPLICABLE", reasons, evidence, confidence: 0.9 };
      }

      if (
        target !== undefined &&
        target < 99.0 &&
        (rto === undefined || rto > 60)
      ) {
        evidence.push({
          source: "availability",
          details: `Задан умеренный уровень доступности ${target}% (RTO: ${rto ?? "не задано"})`,
          value: { target, rto, rpo },
        });
        reasons.push("Показатели непрерывности не требуют уровня SLA 99.9%.");
        return { status: "NOT_APPLICABLE", reasons, evidence, confidence: 0.9 };
      }

      reasons.push(
        "Требования к SLA 99.9% и целевым метрикам RTO/RPO не зафиксированы.",
      );
      return { status: "UNKNOWN", reasons, evidence, confidence: 0.0 };
    },
  },

  // 13. ГОСТ Р 52872-2019 / WCAG 2.1 AA (Доступность веб-интерфейсов)
  {
    id: "wcag_52872",
    title: "ГОСТ Р 52872-2019 / WCAG 2.1 AA (Доступность интерфейсов)",
    category: "ergonomics",
    evaluate: (context) => {
      const evidence: Evidence[] = [];
      const reasons: string[] = [];

      if (
        inRegulatoryScope(context, [
          "wcag",
          "52872",
          "доступность",
          "accessibility",
        ])
      ) {
        evidence.push({
          source: "security.regulatoryScope",
          details:
            "Требования доступности ГОСТ Р 52872-2019 явно включены в скоуп проекта",
          value: context.security?.regulatoryScope,
        });
        reasons.push(
          "Требования доступности веб-интерфейсов включены в нормативный скоуп.",
        );
        return { status: "APPLICABLE", reasons, evidence, confidence: 1.0 };
      }

      const uiComponent = context.architecture?.components?.find((c) =>
        /web|веб|frontend|интерфейс|ui|портал|лк|личный кабинет|мобильн/i.test(
          c,
        ),
      );
      if (uiComponent) {
        evidence.push({
          source: "architecture.components",
          details: `В составе архитектуры системы присутствует пользовательский компонент: «${uiComponent}»`,
          value: uiComponent,
        });
        reasons.push(
          "Система включает пользовательский веб-интерфейс, требуется соблюдение требований доступности по ГОСТ Р 52872-2019.",
        );
        return { status: "APPLICABLE", reasons, evidence, confidence: 0.85 };
      }

      const citizenGroup = context.users?.find((u) =>
        /граждан|клиент|публичн|внешн|пользовател/i.test(
          `${u.name} ${u.description || ""}`,
        ),
      );
      if (citizenGroup) {
        evidence.push({
          source: "users",
          details: `Система ориентирована на широкую аудиторию пользователей: «${citizenGroup.name}»`,
          value: citizenGroup,
        });
        reasons.push(
          "Система предназначена для взаимодействия с внешними пользователями / гражданами.",
        );
        return { status: "APPLICABLE", reasons, evidence, confidence: 0.85 };
      }

      const isHeadless =
        context.architecture?.style &&
        /headless|backend|сервис-сервис|api-only|микросервис/i.test(
          context.architecture.style,
        );
      if (
        isHeadless &&
        (!context.architecture?.components ||
          context.architecture.components.length === 0)
      ) {
        evidence.push({
          source: "architecture.style",
          details: `Система является серверной: «${context.architecture?.style}» без пользовательского интерфейса`,
          value: context.architecture?.style,
        });
        reasons.push("Система не имеет пользовательского интерфейса.");
        return { status: "NOT_APPLICABLE", reasons, evidence, confidence: 0.9 };
      }

      reasons.push(
        "Наличие пользовательского веб-интерфейса и требования доступности не определены.",
      );
      return { status: "UNKNOWN", reasons, evidence, confidence: 0.0 };
    },
  },
];
