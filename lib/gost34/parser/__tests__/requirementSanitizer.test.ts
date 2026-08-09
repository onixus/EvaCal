import { describe, it, expect } from "vitest";
import { Gost34RequirementItem } from "../../types";
import { fromGost34RequirementItems } from "../../requirements";
import {
  detectRequirementCategory,
  normalizeRequirementItems,
  normalizeRequirementItemsV2,
  sanitizeRawText,
} from "../requirementSanitizer";

describe("sanitizeRawText", () => {
  it("strips BOM, zero-width space, soft hyphen and control characters", () => {
    const { text, stats } = sanitizeRawText("﻿тек​ст­а\x07б");
    expect(text).toBe("текстаб");
    expect(stats.removedGarbageChars).toBe(4);
  });

  it("keeps newlines and tabs", () => {
    expect(sanitizeRawText("а\nб\tв").text).toBe("а\nб в");
  });

  it("drops header/footer boilerplate lines", () => {
    const { text, stats } = sanitizeRawText(
      [
        "Требование 1",
        "Стр. 1 из 45",
        "Конфиденциально",
        "Страница 7",
        "Требование 2",
      ].join("\n"),
    );
    expect(text).toBe("Требование 1\nТребование 2");
    expect(stats.removedBoilerplateLines).toBe(3);
  });

  it("collapses runs of whitespace and blank lines", () => {
    expect(sanitizeRawText("а   б\n\n\n\nв").text).toBe("а б\n\nв");
  });
});

describe("detectRequirementCategory", () => {
  it.each([
    ["Требуется шифрование канала и авторизация", "security"],
    ["Резервное копирование и восстановление, RTO", "reliability"],
    ["Время отклика под нагрузкой", "performance"],
    ["Интерфейс должен быть удобен пользователю", "ergonomics"],
    ["Развёртывание на сервере с СУБД PostgreSQL", "technical"],
    ["Формирование печатной формы договора", "functional"],
  ] as Array<[string, string]>)("%s -> %s", (text, expected) => {
    expect(detectRequirementCategory(text)).toBe(expected);
  });
});

const rawItems: Gost34RequirementItem[] = [
  {
    id: "r1",
    code: "ТР-ВЕНД-01",
    category: "functional",
    title: "• 1.1. Ведение   журнала",
    description: "—  Система   должна вести журнал событий безопасности.",
  },
  {
    id: "r2",
    code: "REQ-2",
    category: "functional",
    title: "2) Отклик",
    description: "Время отклика под нагрузкой не более 2 с.",
  },
  {
    id: "r3",
    code: "ТР-ФУНК-99",
    category: "functional",
    title: "Печать договора",
    description: "Формирование печатной формы договора.",
  },
];

describe("normalizeRequirementItems", () => {
  it("cleans titles and descriptions and renumbers vendor codes by category", () => {
    const out = normalizeRequirementItems(rawItems);
    expect(
      out.map((r) => [r.code, r.category, r.title, r.description]),
    ).toEqual([
      [
        "ТР-БЕЗ-01",
        "security",
        "Ведение журнала",
        "Система должна вести журнал событий безопасности.",
      ],
      [
        "ТР-ПРОИЗ-01",
        "performance",
        "Отклик",
        "Время отклика под нагрузкой не более 2 с.",
      ],
      // an already-structured code is left alone
      [
        "ТР-ФУНК-99",
        "functional",
        "Печать договора",
        "Формирование печатной формы договора.",
      ],
    ]);
  });

  it("increments the per-category counter", () => {
    const out = normalizeRequirementItems([
      { ...rawItems[0], id: "a" },
      { ...rawItems[0], id: "b" },
    ]);
    expect(out.map((r) => r.code)).toEqual(["ТР-БЕЗ-01", "ТР-БЕЗ-02"]);
  });

  it("preserves the original wording while the description is cleaned", () => {
    const out = normalizeRequirementItems(rawItems);
    expect(out[0].originalText).toBe(rawItems[0].description);
    expect(out[0].description).not.toBe(rawItems[0].description);
  });

  it("does not overwrite an originalText carried in from an earlier pass", () => {
    const out = normalizeRequirementItems([
      { ...rawItems[0], originalText: "самый первый текст" },
    ]);
    expect(out[0].originalText).toBe("самый первый текст");
  });

  it("falls back to the description when the title is only punctuation", () => {
    const out = normalizeRequirementItems([{ ...rawItems[2], title: "• 1." }]);
    expect(out[0].title).toBe("Формирование печатной формы договора.");
  });
});

describe("normalizeRequirementItemsV2", () => {
  it("writes the cleaned text to normalizedText and leaves originalText intact", () => {
    const [out] = normalizeRequirementItemsV2(
      fromGost34RequirementItems([rawItems[0]]),
    );
    expect(out.originalText).toBe(rawItems[0].description);
    expect(out.normalizedText).toBe(
      "Система должна вести журнал событий безопасности.",
    );
    expect(out.approval.status).toBe("DRAFT");
  });
});
