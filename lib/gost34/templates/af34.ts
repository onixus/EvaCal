import { Gost34InputPayload, Gost34Section } from "../types";
import {
  Gost34RequirementV2,
  getRequirementEffectiveText,
} from "../requirements/v2";

export function buildAF34Sections(
  payload: Gost34InputPayload,
): Gost34Section[] {
  const meta = payload.metadata;
  const reqs = payload.customRequirements || [];
  const reqsV2: Gost34RequirementV2[] =
    payload.requirementsV2 ||
    reqs.map((r) => ({
      id: r.id,
      code: r.code,
      category: r.category,
      type: "functional",
      title: r.title,
      originalText: r.description,
      approval: { status: "APPROVED" },
    }));

  return [
    {
      id: "sec-1",
      numStr: "1",
      title: "НАЗНАЧЕНИЕ И СОСТАВ АВТОМАТИЗИРУЕМЫХ ФУНКЦИЙ",
      paragraphs: [
        `1.1 Документ определяет функциональную структуру системы «${meta.systemName}».`,
        `1.2 Автоматизируемые функции предназначены для удовлетворения требований Заказчика (${meta.customerName}).`,
      ],
    },
    {
      id: "sec-2",
      numStr: "2",
      title: "ХАРАКТЕРИСТИКА ВЫПОЛНЯЕМЫХ ФУНКЦИЙ И ПОДСИСТЕМ",
      paragraphs: [
        "2.1 Полный реестр автоматизируемых функций приведен в Таблице 1.",
      ],
      tables: [
        {
          caption: "Таблица 1 — Реестр автоматизируемых функций АС",
          headers: [
            "Код функции",
            "Наименование функции",
            "Категория / Подсистема",
            "Описание алгоритма",
          ],
          rows: reqsV2.map((r) => [
            r.code,
            r.title,
            r.category,
            getRequirementEffectiveText(r),
          ]),
        },
      ],
    },
    {
      id: "sec-3",
      numStr: "3",
      title: "СВЯЗИ МЕЖДУ ФУНКЦИЯМИ И ПОДОКРУЖЕНИЕМ",
      paragraphs: [
        "3.1 Функция ввода и обработки первичных данных.",
        "3.2 Функция вычисления параметров и сохранения промежуточных состояний.",
        "3.3 Функция формирования и экспорта отчетной нормативной документации.",
      ],
    },
  ];
}
