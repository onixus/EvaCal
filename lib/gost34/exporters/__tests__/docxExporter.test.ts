import { describe, it, expect } from 'vitest';
import { exportGost34ToDocx } from '../docxExporter';
import { Gost34DocumentAST } from '../../types';
import JSZip from 'jszip';
import { convertMillimetersToTwip } from 'docx';
import { xml2js } from 'xml-js';
import { LAYOUT_PROFILES, getLayoutProfile, resolveLayoutProfileId } from '../layout';

describe('DOCX Exporter and Layout Profiles', () => {
  const dummyAst: Gost34DocumentAST = {
    metadata: {
      docType: 'TZ',
      systemName: 'ЕваКалл',
      fullSystemName: 'Система калькуляции ЕваКалл',
      documentCode: 'АБВГ.123456.001 ТЗ',
      customerName: 'ООО Заказчик',
      developerName: 'ООО Разработчик',
      signatures: {
        developer: 'Иванов И.И.',
        checker: 'Петров П.П.',
        techControl: 'Сидоров С.С.',
        normControl: 'Кузнецов К.К.',
        approver: 'Васильев В.В.',
      },
      city: 'Москва',
      year: 2026,
      version: '1.0',
    },
    sections: [
      {
        id: 'sec-1',
        numStr: '1',
        title: 'ОБЩИЕ СВЕДЕНИЯ',
        paragraphs: ['Тестовый абзац раздела общие сведения.'],
      },
    ],
  };

  it('should default to the ESKD frame layout profile if omitted', () => {
    const profile = getLayoutProfile();
    expect(profile.id).toBe('gost34-eskd-frame');
    expect(profile.showEskdFrames).toBe(true);
  });

  it('should ignore unknown layout ids and fall back to the default profile', () => {
    expect(getLayoutProfile('nonsense').id).toBe('gost34-eskd-frame');
    expect(resolveLayoutProfileId('nonsense')).toBeUndefined();
    expect(resolveLayoutProfileId(null)).toBeUndefined();
    expect(resolveLayoutProfileId('gost34-modern')).toBe('gost34-modern');
  });

  it('should render ESKD frames and stamps when no layout is specified', async () => {
    const buffer = await exportGost34ToDocx(dummyAst);
    const zip = await JSZip.loadAsync(buffer);

    const documentXml = await zip.file('word/document.xml')!.async('string');
    // Рамка рисуется VML-фигурой в колонтитуле, а не границами страницы
    expect(documentXml).not.toContain('<w:pgBorders');
    // Форма 2 на первом листе, форма 2а — на последующих
    expect(documentXml).toContain('w:type="first"');
    expect(documentXml).toContain('w:type="default"');
    // Поле текста слева 25 мм — на 5 мм внутрь от линии рамки
    expect(documentXml).toContain(`w:left="${convertMillimetersToTwip(25)}"`);

    const headers = Object.keys(zip.files).filter((n) => /^word\/header\d+\.xml$/.test(n));
    expect(headers.length).toBe(4); // default + first на каждую из двух секций
    const headerContents = await Promise.all(headers.map((n) => zip.file(n)!.async('string')));
    for (const xml of headerContents) {
      expect(xml).toContain('<v:rect');
      // 20 мм слева, 5 мм сверху, 185×287 мм — геометрия по ГОСТ 2.301-68
      expect(xml).toContain('margin-left:56.69pt');
      expect(xml).toContain('margin-top:14.17pt');
      expect(xml).toContain('width:524.41pt');
      expect(xml).toContain('height:813.54pt');
      expect(xml).toContain('mso-position-horizontal-relative:page');
    }
    // Идентификаторы фигур не должны повторяться в пределах документа
    const shapeIds = headerContents.map((xml) => /o:spid="([^"]+)"/.exec(xml)?.[1]);
    expect(new Set(shapeIds).size).toBe(headers.length);

    const footers = Object.keys(zip.files).filter((n) => /^word\/footer\d+\.xml$/.test(n));
    expect(footers.length).toBe(2);
    const footerContents = await Promise.all(footers.map((n) => zip.file(n)!.async('string')));
    expect(footerContents.some((xml) => xml.includes('Н.контр.'))).toBe(true);
    expect(footerContents.every((xml) => xml.includes('№ докум.'))).toBe(true);
    // Штампы прижаты к левой линии рамки отрицательным отступом в 5 мм
    for (const xml of footerContents) {
      expect(xml).toContain(`<w:tblInd w:type="dxa" w:w="${convertMillimetersToTwip(-5)}"/>`);
    }
  });

  it('should emit well-formed parts Word can open', async () => {
    const zip = await JSZip.loadAsync(await exportGost34ToDocx(dummyAst));
    const parts = Object.keys(zip.files).filter((n) => /\.(xml|rels)$/.test(n));
    expect(parts.length).toBeGreaterThan(0);

    for (const name of parts) {
      const xml = await zip.file(name)!.async('string');
      // Обёртка ImportedXmlComponent однажды дописывала в колонтитул `</undefined>`,
      // из-за чего Word требовал восстановления документа.
      expect(xml, `${name} содержит незакрытый тег-обёртку`).not.toContain('undefined');

      expect(() => xml2js(xml), `${name} не является корректным XML`).not.toThrow();
    }
  });

  it('should not render frames or stamps for the modern layout profile', async () => {
    const ast = {
      ...dummyAst,
      metadata: { ...dummyAst.metadata, layoutProfileId: 'gost34-modern' as const },
    };

    const zip = await JSZip.loadAsync(await exportGost34ToDocx(ast));
    const headers = Object.keys(zip.files).filter((n) => /^word\/header\d+\.xml$/.test(n));
    expect(headers.length).toBe(0);

    const footers = Object.keys(zip.files).filter((n) => /^word\/footer\d+\.xml$/.test(n));
    const footerContents = await Promise.all(footers.map((n) => zip.file(n)!.async('string')));
    expect(footerContents.every((xml) => !xml.includes('№ докум.'))).toBe(true);
  });

  it('should retrieve specified layout profiles correctly', () => {
    expect(getLayoutProfile('gost34-modern').id).toBe('gost34-modern');
    expect(getLayoutProfile('gost34-eskd-frame').id).toBe('gost34-eskd-frame');
    expect(getLayoutProfile('gost34-eskd-frame').showEskdFrames).toBe(true);
    expect(getLayoutProfile('plain-corporate').id).toBe('plain-corporate');
  });

  it('should export DOCX buffer for gost34-modern layout profile', async () => {
    const ast = {
      ...dummyAst,
      metadata: {
        ...dummyAst.metadata,
        layoutProfileId: 'gost34-modern' as const,
      },
    };

    const buffer = await exportGost34ToDocx(ast);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);
  });

  it('should export DOCX buffer for gost34-eskd-frame layout profile', async () => {
    const ast = {
      ...dummyAst,
      metadata: {
        ...dummyAst.metadata,
        layoutProfileId: 'gost34-eskd-frame' as const,
      },
    };

    const buffer = await exportGost34ToDocx(ast);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);
  });
});
