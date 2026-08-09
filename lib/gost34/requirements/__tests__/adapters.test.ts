import { describe, it, expect } from "vitest";
import { Gost34RequirementItem } from "../../types";
import {
  fromGost34RequirementItem,
  fromGost34RequirementItems,
  toGost34RequirementItem,
  toGost34RequirementItems,
} from "../adapters";

const fullItem: Gost34RequirementItem = {
  id: "req-7",
  code: "ТР-БЕЗ-03",
  category: "security",
  title: "Требование к защите",
  description: "Система должна вести журнал событий безопасности.",
  sourceFile: "vendor-tz.docx",
  stageName: "Разработка ИБ",
  stageRole: "инженер",
  mappedStageId: "s3",
  mappedStageName: "Разработка ИБ",
  mappedRole: "инженер",
};

describe("round trip", () => {
  it("preserves every field the templates read", () => {
    const back = toGost34RequirementItem(fromGost34RequirementItem(fullItem));
    expect(back).toEqual({ ...fullItem, originalText: fullItem.description });
  });

  it("preserves an array", () => {
    const back = toGost34RequirementItems(
      fromGost34RequirementItems([fullItem]),
    );
    expect(back).toHaveLength(1);
    expect(back[0].code).toBe(fullItem.code);
  });

  it("keeps a minimal item minimal", () => {
    const minimal: Gost34RequirementItem = {
      id: "req-1",
      code: "ТР-ФУНК-01",
      category: "functional",
      title: "T",
      description: "D",
    };
    expect(toGost34RequirementItem(fromGost34RequirementItem(minimal))).toEqual(
      {
        ...minimal,
        originalText: "D",
      },
    );
  });
});

describe("fromGost34RequirementItem", () => {
  it("seeds originalText from description when absent", () => {
    const v2 = fromGost34RequirementItem(fullItem);
    expect(v2.originalText).toBe(fullItem.description);
    expect(v2.normalizedText).toBeUndefined();
  });

  it("never overwrites an originalText that survived an earlier conversion", () => {
    const cleaned: Gost34RequirementItem = {
      ...fullItem,
      originalText: "Стр. 4 из 12  Система   должна вести журнал.",
      description: "Система должна вести журнал.",
    };
    const v2 = fromGost34RequirementItem(cleaned);
    expect(v2.originalText).toBe(cleaned.originalText);
    expect(v2.normalizedText).toBe(cleaned.description);

    // and a second trip through the adapters still does not clobber it
    const twice = fromGost34RequirementItem(
      toGost34RequirementItem(v2, { preferNormalized: true }),
    );
    expect(twice.originalText).toBe(cleaned.originalText);
  });

  it("defaults to DRAFT and infers the requirement type from the code", () => {
    expect(fromGost34RequirementItem(fullItem).approval.status).toBe("DRAFT");
    expect(fromGost34RequirementItem(fullItem).type).toBe("system");
    expect(
      fromGost34RequirementItem({ ...fullItem, code: "ТР-ГОСТ-01" }).type,
    ).toBe("regulatory");
  });

  it("accepts explicit status, type and source overrides", () => {
    const v2 = fromGost34RequirementItem(
      { ...fullItem, sourceFile: undefined },
      {
        status: "APPROVED",
        type: "regulatory",
        sourceFilename: "enricher",
        sourceSection: "Этап 1",
      },
    );
    expect(v2.approval.status).toBe("APPROVED");
    expect(v2.type).toBe("regulatory");
    expect(v2.source).toEqual({ filename: "enricher", section: "Этап 1" });
  });
});

describe("toGost34RequirementItem", () => {
  const proposed = fromGost34RequirementItem({
    ...fullItem,
    originalText: "исходная формулировка",
    description: "нормализованная формулировка",
  });

  it("uses the original text for an unapproved requirement by default", () => {
    expect(toGost34RequirementItem(proposed).description).toBe(
      "исходная формулировка",
    );
  });

  it("uses the normalized text when preferNormalized is set", () => {
    expect(
      toGost34RequirementItem(proposed, { preferNormalized: true }).description,
    ).toBe("нормализованная формулировка");
  });

  it("falls back to the original when preferNormalized finds nothing normalized", () => {
    const plain = fromGost34RequirementItem(fullItem);
    expect(
      toGost34RequirementItem(plain, { preferNormalized: true }).description,
    ).toBe(fullItem.description);
  });
});
