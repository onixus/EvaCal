import { Gost34InputPayload, Gost34Section } from "../types";
import {
  buildTraceability,
  generateTraceabilityTable,
} from "../traceability/engine";
import { Gost34RequirementV2 } from "../requirements/v2";

export function buildTZ34Sections(
  payload: Gost34InputPayload,
): Gost34Section[] {
  const meta = payload.metadata;
  const stages = payload.stages;
  const risks = payload.risks || [];
  const reqs = payload.customRequirements || [];
  const citations = payload.standardProfile.citations;

  // Use provided V2 requirements or map legacy ones to V2 on the fly
  const reqsV2: Gost34RequirementV2[] =
    payload.requirementsV2 ||
    reqs.map((r) => ({
      id: r.id,
      code: r.code,
      category: r.category,
      type: "business",
      title: r.title,
      originalText: r.description,
      approval: { status: "APPROVED" },
      source: { filename: r.sourceFile },
    }));

  const traceabilityResult =
    payload.traceability || buildTraceability(reqsV2, stages);
  const traceabilityTable = generateTraceabilityTable(
    reqsV2,
    stages,
    traceabilityResult,
  );

  const sections: Gost34Section[] = [
    {
      id: "sec-1",
      numStr: "1",
      title: "ОБЩИЕ СВЕДЕНИЯ",
      paragraphs: [
        `1.1 Полное наименование системы: ${meta.fullSystemName}.`,
        `1.2 Краткое наименование системы: ${meta.systemName}.`,
        `1.3 Обозначение документа: ${meta.documentCode}.`,
        `1.4 Наименование Заказчика: ${meta.customerName}.`,
        `1.5 Наименование Разработчика: ${meta.developerName}.`,
        `1.6 Основанием для проведения работ является ${meta.contractNumber || "договор между Заказчиком и Разработчиком"}.`,
        `1.7 Сроки начала и окончания работ определяются календарным планом проекта в соответствии с разделом 5 настоящего ТЗ.`,
      ],
    },
    {
      id: "sec-2",
      numStr: "2",
      title: "НАЗНАЧЕНИЕ И ЦЕЛИ СОЗДАНИЯ (РАЗВИТИЯ) СИСТЕМЫ",
      paragraphs: [
        `2.1 Назначение системы: Система «${meta.systemName}» предназначена для автоматизации процессов планирования, расчёта трудозатрат и управления жизненным циклом проекта.`,
        `2.2 Цели создания системы:`,
        `— Повышение точности оценки трудоемкости и сроков выполнения этапов;`,
        `— Сокращение рисков проектов и времени согласования технических требований;`,
        `— Автоматическое формирование нормативной документации по стандарту ГОСТ 34.`,
      ],
    },
    {
      id: "sec-3",
      numStr: "3",
      title: "ХАРАКТЕРИСТИКА ОБЪЕКТОВ АВТОМАТИЗАЦИИ",
      paragraphs: [
        `3.1 Объектом автоматизации являются производственные и управленческие процессы Заказчика (${meta.customerName}).`,
        `3.2 Условия эксплуатации: Система эксплуатируется в корпоративной сети Заказчика через стандартный веб-интерфейс.`,
      ],
    },
    {
      id: "sec-4",
      numStr: "4",
      title: "ТРЕБОВАНИЯ К СИСТЕМЕ",
      paragraphs: [
        "Совокупность требований к структуре, функциям и видам обеспечения проектируемой системы.",
      ],
      subsections: [
        {
          id: "sec-4-1",
          numStr: "4.1",
          title: "Требования к системе в целом",
          paragraphs: [
            "4.1.1 Требования к структуре: Модульная веб-архитектура с ролевой моделью пользователей.",
            "4.1.2 Требования к надежности: Время доступности 99.9%, RTO не более 2 часов, RPO не более 15 минут.",
            "4.1.3 Требования к безопасности: Соблюдение 152-ФЗ, Приказов ФСТЭК России № 21 и № 117, ГОСТ Р 56939-2016 (безопасная разработка ПО), шифрование паролей bcrypt, разграничение доступов (RBAC).",
            "4.1.4 Требования к эргономике: Соответствие WCAG 2.1 AA и ГОСТ Р ИСО 9241.",
          ],
        },
        {
          id: "sec-4-2",
          numStr: "4.2",
          title: "Требования к функциям (задачам), выполняемым системой",
          paragraphs: [
            "Перечень сформированных функциональных и нефункциональных требований:",
          ],
          tables: [
            {
              caption: "Таблица 1 — Спецификация требований к системе",
              headers: [
                "Код требования",
                "Категория / Название",
                "Описание требования",
              ],
              rows: reqs.map((r) => [r.code, r.title, r.description]),
            },
          ],
        },
        {
          id: "sec-4-3",
          numStr: "4.3",
          title: "Требования к видам обеспечения",
          paragraphs: [
            "4.3.1 Информационное обеспечение: Реляционная СУБД (PostgreSQL/SQLite) под управлением Prisma ORM.",
            "4.3.2 Программное обеспечение: Node.js 20+, Next.js 15 App Router, TypeScript, Tailwind CSS.",
            "4.3.3 Техническое обеспечение: Вычислительный сервер (2+ vCPU, 4+ GB RAM) с поддержкой Docker.",
          ],
        },
      ],
    },
    {
      id: "sec-5",
      numStr: "5",
      title: "СОСТАВ И СОДЕРЖАНИЕ РАБОТ ПО СОЗДАНИЮ СИСТЕМЫ",
      paragraphs: [
        "5.1 Перечень этапов работ и трудозатраты приведены в Таблице 2.",
        "5.2 Матрица прослеживаемости связей между вендорскими требованиями и этапами реализации представлена в Таблице 3.",
      ],
      tables: [
        {
          caption: "Таблица 2 — Календарный план и состав этапов работ",
          headers: [
            "№",
            "Наименование этапа",
            "Роль исполнителя",
            "Трудозатраты (ч)",
            "Требования и ограничения",
          ],
          rows: stages.map((stg) => [
            stg.order,
            stg.name,
            stg.role,
            stg.hours,
            stg.requirements || "—",
          ]),
        },
        traceabilityTable,
      ],
    },
    {
      id: "sec-6",
      numStr: "6",
      title: "ПОРЯДОК КОНТРОЛЯ И ПРИЕМКИ СИСТЕМЫ",
      paragraphs: [
        `6.1 Приемка системы осуществляется по результатам приемо-сдаточных испытаний (ПСИ) в соответствии с ПМИ (${citations.testing}).`,
        "6.2 По результатам ПСИ подписывается двусторонний Акт сдачи-приемки выполненных работ.",
      ],
    },
    {
      id: "sec-7",
      numStr: "7",
      title:
        "ТРЕБОВАНИЯ К ПОДГОТОВКЕ ОБЪЕКТА АВТОМАТИЗАЦИИ К ВВОДУ СИСТЕМЫ В ЭКСПЛУАТАЦИЮ",
      paragraphs: [
        "7.1 Подготовка серверной инфраструктуры и назначение администраторов Заказчика.",
      ],
    },
    {
      id: "sec-8",
      numStr: "8",
      title: "ТРЕБОВАНИЯ К ДОКУМЕНТИРОВАНИЮ",
      paragraphs: [`8.1 ${citations.documentationSetSentence}`],
    },
    {
      id: "sec-9",
      numStr: "9",
      title: "ИСТОЧНИКИ РАЗРАБОТКИ",
      paragraphs: [
        `9.1 ${citations.referencesList}`,
        `9.2 Материалы опросника и технические требования проекта «${meta.systemName}».`,
      ],
    },
  ];

  if (risks.length > 0) {
    const sec5 = sections.find((s) => s.id === "sec-5");
    if (sec5) {
      sec5.paragraphs.push("5.3 Учтённые риски проекта приведены в Таблице 4.");
      sec5.tables = sec5.tables || [];
      sec5.tables.push({
        caption: "Таблица 4 — Резерв на риски проекта",
        headers: ["№", "Описание риска", "Часы (ч)"],
        rows: risks.map((r, idx) => [idx + 1, r.description, r.hours]),
      });
    }
  }

  return sections;
}
