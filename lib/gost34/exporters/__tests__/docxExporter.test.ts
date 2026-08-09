import { describe, it, expect } from "vitest";
import { exportGost34ToDocx } from "../docxExporter";
import { Gost34DocumentAST } from "../../types";
import { LAYOUT_PROFILES, getLayoutProfile } from "../layout";

describe("DOCX Exporter and Layout Profiles", () => {
  const dummyAst: Gost34DocumentAST = {
    metadata: {
      docType: "TZ",
      systemName: "ЕваКалл",
      fullSystemName: "Система калькуляции ЕваКалл",
      documentCode: "АБВГ.123456.001 ТЗ",
      customerName: "ООО Заказчик",
      developerName: "ООО Разработчик",
      signatures: {
        developer: "Иванов И.И.",
        checker: "Петров П.П.",
        techControl: "Сидоров С.С.",
        normControl: "Кузнецов К.К.",
        approver: "Васильев В.В.",
      },
      city: "Москва",
      year: 2026,
      version: "1.0",
    },
    sections: [
      {
        id: "sec-1",
        numStr: "1",
        title: "ОБЩИЕ СВЕДЕНИЯ",
        paragraphs: ["Тестовый абзац раздела общие сведения."],
      },
    ],
  };

  it("should retrieve default layout profile if omitted", () => {
    const profile = getLayoutProfile();
    expect(profile.id).toBe("gost34-modern");
    expect(profile.showEskdFrames).toBe(false);
  });

  it("should retrieve specified layout profiles correctly", () => {
    expect(getLayoutProfile("gost34-modern").id).toBe("gost34-modern");
    expect(getLayoutProfile("gost34-eskd-frame").id).toBe("gost34-eskd-frame");
    expect(getLayoutProfile("gost34-eskd-frame").showEskdFrames).toBe(true);
    expect(getLayoutProfile("plain-corporate").id).toBe("plain-corporate");
  });

  it("should export DOCX buffer for gost34-modern layout profile", async () => {
    const ast = {
      ...dummyAst,
      metadata: {
        ...dummyAst.metadata,
        layoutProfileId: "gost34-modern" as const,
      },
    };

    const buffer = await exportGost34ToDocx(ast);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);
  });

  it("should export DOCX buffer for gost34-eskd-frame layout profile", async () => {
    const ast = {
      ...dummyAst,
      metadata: {
        ...dummyAst.metadata,
        layoutProfileId: "gost34-eskd-frame" as const,
      },
    };

    const buffer = await exportGost34ToDocx(ast);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);
  });
});
