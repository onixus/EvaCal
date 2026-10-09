import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import {
  parseSpecification,
  specificationBlockers,
  requireConfirmedSpecification,
} from './validation';
import type { SpecificationItem, SpecificationSnapshot } from './types';
import { prepareGost34Document } from '../gost34/generation/prepareDocument';
import { generateGost34Document } from '../gost34/generation/exportDocument';

export const item: SpecificationItem = {
  id: 'manual-1',
  kind: 'hardware',
  disposition: 'supply',
  name: 'Нестандартная платформа',
  vendor: 'Новый вендор',
  sku: 'CPU-42',
  quantity: '4',
  unit: 'шт.',
  configuration: '16 CPU / 128 RAM',
  licensing: '',
  term: '12 месяцев по договору',
  source: 'КП поставщика № 4',
  rationale: 'Ручной сайзинг архитектора',
  confirmed: true,
  unitPrice: '0',
  currency: 'RUB',
};
export const confirmed: SpecificationSnapshot = {
  version: 1,
  status: 'confirmed',
  emptySupplyReason: '',
  items: [item],
};
const calculation = { id: 'c1', name: 'Проверка', customer: 'Тест', stages: [], risks: [] };
const params = (answers: Record<string, unknown> = {}, specification?: SpecificationSnapshot) => ({
  calculation: { ...calculation, answers, specification },
  metadataOverride: { docType: 'SPEC' as const },
});

describe('Спецификация не выдумывает поставку', () => {
  it.each([
    {},
    { ngfw_clusters_count: 0 },
    { platform: 'PostgreSQL community' },
    { servers_count: 4 },
    { deployment: 'cloud', platform: 'Веб-приложение' },
    { ngfw_clusters_count: 1, ngfw_ha_required: false, internet_throughput_gbps: 1 },
    { racks_count: 0 },
    { licenses_count: 0 },
  ])('блокирует выпуск при отсутствии проектного состава: %j', (answers) => {
    const preview = prepareGost34Document(params(answers), { mode: 'preview' });
    expect(preview.diagnostics.issues.length).toBeGreaterThan(0);
    expect(preview.ast.sections[0].paragraphs.join(' ')).toContain('ЧЕРНОВИК');
    for (const s of preview.ast.sections.slice(1, 4)) expect(s.tables?.[0].rows).toEqual([]);
    expect(() => prepareGost34Document(params(answers), { mode: 'export' })).toThrow(
      'Состав поставки не задан',
    );
  });

  it('не меняет принятую модель, HA, количество и гарантию из-за ответов', () => {
    const a = prepareGost34Document(
      params({ servers_count: 500, ngfw_ha_required: true }, confirmed),
    );
    const b = prepareGost34Document(
      params({ servers_count: 0, platform: 'PostgreSQL community' }, confirmed),
    );
    expect(a.ast.sections).toEqual(b.ast.sections);
    expect(a.diagnostics.issues).toEqual([]);
    const rows = a.ast.sections[2].tables![0].rows;
    expect(rows).toHaveLength(1);
    expect(rows[0][4]).toBe('4 шт.');
    const text = JSON.stringify(a.ast);
    expect(text).not.toContain('36 месяцев');
    expect(text).not.toContain('YADRO');
    expect(text).not.toContain('Aquarius');
    expect(text).toContain('12 месяцев');
  });

  it('одни строки в снимке, preview, DOCX и ZIP', async () => {
    const snapshot = parseSpecification(JSON.parse(JSON.stringify(confirmed)));
    const input = params({}, snapshot);
    const preview = prepareGost34Document(input, { mode: 'preview' });
    const exported = await generateGost34Document(input);
    expect(exported.ast.sections).toEqual(preview.ast.sections);
    const docx = await JSZip.loadAsync(exported.buffer);
    const xml = (await docx.file('word/document.xml')!.async('string')).replace(/\u00a0/g, ' ');
    for (const value of ['Нестандартная платформа', 'CPU-42', '4 шт.', 'КП поставщика № 4'])
      expect(xml).toContain(value);
    const zip = new JSZip().file('SPEC.docx', exported.buffer);
    const reopened = await JSZip.loadAsync(await zip.generateAsync({ type: 'nodebuffer' }));
    expect(await reopened.file('SPEC.docx')!.async('nodebuffer')).toEqual(exported.buffer);
  });
});

describe('Валидация и подтверждение', () => {
  it.each([-1, false, 1, '1e3', 'NaN', 'Infinity', '-2', '0.0000001'])(
    'отклоняет некорректное количество %j',
    (quantity) => {
      expect(() => parseSpecification({ ...confirmed, items: [{ ...item, quantity }] })).toThrow();
    },
  );
  it('различает неизвестную цену, бесплатную строку и нулевое количество', () => {
    expect(
      parseSpecification({ ...confirmed, items: [{ ...item, unitPrice: null }] }).items[0]
        .unitPrice,
    ).toBeNull();
    expect(parseSpecification(confirmed).items[0].unitPrice).toBe('0');
    expect(() =>
      requireConfirmedSpecification({ ...confirmed, items: [{ ...item, quantity: '0' }] }),
    ).toThrow('положительное количество');
  });
  it('не выпускает черновик, кандидата, альтернативу, неполную лицензию', () => {
    expect(() => requireConfirmedSpecification({ ...confirmed, status: 'draft' })).toThrow(
      'не подтверждена',
    );
    expect(() =>
      requireConfirmedSpecification({ ...confirmed, items: [{ ...item, confirmed: false }] }),
    ).toThrow();
    expect(() =>
      requireConfirmedSpecification({
        ...confirmed,
        items: [{ ...item, disposition: 'alternative' }],
      }),
    ).toThrow('альтернативу');
    expect(() =>
      requireConfirmedSpecification({ ...confirmed, items: [{ ...item, kind: 'license' }] }),
    ).toThrow('лицензирования');
  });
  it('разрешает имеющееся оборудование и явное отсутствие поставки', () => {
    expect(
      specificationBlockers({ ...confirmed, items: [{ ...item, disposition: 'existing' }] }),
    ).toEqual([]);
    expect(() =>
      requireConfirmedSpecification({
        ...confirmed,
        emptySupplyReason: 'Используем облако заказчика',
        items: [],
      }),
    ).not.toThrow();
    expect(() => requireConfirmedSpecification({ ...confirmed, items: [] })).toThrow(
      'отсутствие поставки',
    );
  });
  it('не принимает повторяющиеся ID и неизвестные типы', () => {
    expect(() => parseSpecification({ ...confirmed, items: [item, item] })).toThrow('уникальными');
    expect(() =>
      parseSpecification({ ...confirmed, items: [{ ...item, kind: '__proto__' }] }),
    ).toThrow();
  });
  it('удаление позиции сохраняется, без повторного автодобавления', () => {
    const input = params(
      { servers_count: 50 },
      { ...confirmed, items: [], emptySupplyReason: 'Поставка исключена' },
    );
    expect(prepareGost34Document(input).ast.sections[2].tables![0].rows).toEqual([]);
  });
});
