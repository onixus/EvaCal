import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseSpecification } from './validation';
import { diffSpecifications, rowChanged } from './diff';
import {
  applyRequirementCodes,
  linkedRequirementIds,
  requirementBasisText,
  requirementLinkWarnings,
  requirementOptionsFromSnapshot,
  type RequirementOptions,
} from './requirements';
import { renderSpecificationXlsx, SPEC_XLSX_HEADERS } from './xlsx';
import type { SpecificationItem, SpecificationSnapshot } from './types';
import { prepareGost34Document } from '../gost34/generation/prepareDocument';

const row = (over: Partial<SpecificationItem> = {}): SpecificationItem => ({
  id: 'srv',
  kind: 'hardware',
  disposition: 'supply',
  name: 'Сервер СУБД',
  vendor: 'V',
  sku: 'S-1',
  quantity: '2',
  unit: 'шт.',
  configuration: '',
  licensing: '',
  term: '',
  source: 'КП',
  rationale: 'Сайзинг',
  confirmed: true,
  unitPrice: '100',
  currency: 'RUB',
  ...over,
});
const snap = (items: SpecificationItem[], version = 1): SpecificationSnapshot => ({
  version,
  status: 'draft',
  emptySupplyReason: '',
  items,
});
const options: RequirementOptions = {
  source: { kind: 'draft', packageId: 'p1', version: 2, status: 'draft' },
  requirements: [
    {
      id: 'req-1',
      code: 'ТР-Ф-01',
      title: 'Отказоустойчивость СУБД',
      category: 'reliability',
      description: '',
    },
    { id: 'req-2', code: 'ТР-ТО-02', title: 'Серверы', category: 'hardware_pac', description: '' },
  ],
};

describe('связи позиций с требованиями: валидация', () => {
  it('принимает список ID и коды связанных требований, старые строки без поля валидны', () => {
    const parsed = parseSpecification(
      snap([
        row({ requirementIds: ['req-1', 'req-2'], requirementCodes: { 'req-1': 'ТР-Ф-01' } }),
        row({ id: 'old' }),
      ]),
    );
    expect(parsed.items[0].requirementIds).toEqual(['req-1', 'req-2']);
    expect(parsed.items[0].requirementCodes).toEqual({ 'req-1': 'ТР-Ф-01' });
    expect(parsed.items[1]).not.toHaveProperty('requirementIds');
  });
  it('пустой список равен отсутствию связей', () => {
    const parsed = parseSpecification(snap([row({ requirementIds: [] })]));
    expect(parsed.items[0]).not.toHaveProperty('requirementIds');
  });
  it.each([
    [{ requirementIds: ['a', 'a'] }, 'повторяются'],
    [{ requirementIds: [''] }, 'Пустой ID'],
    [{ requirementIds: 'req-1' }, 'список'],
    [{ requirementIds: [1] }, 'ID требования'],
    [{ requirementIds: Array.from({ length: 101 }, (_, i) => `r${i}`) }, 'до 100'],
    [{ requirementCodes: { a: 'ТР' } }, 'без связей'],
    [{ requirementIds: ['a'], requirementCodes: { b: 'ТР' } }, 'не связанного'],
  ])('отклоняет %j', (over, message) => {
    expect(() => parseSpecification(snap([row(over as Partial<SpecificationItem>)]))).toThrow(
      message,
    );
  });
});

describe('связи позиций с требованиями: diff', () => {
  it('добавление и снятие связи — изменение строки с кодами в отчете', () => {
    const before = snap([row()]);
    const after = snap(
      [row({ requirementIds: ['req-1'], requirementCodes: { 'req-1': 'ТР-Ф-01' } })],
      2,
    );
    const diff = diffSpecifications(before, after);
    expect(diff.changed[0].changes).toEqual([
      { field: 'requirementIds', before: null, after: 'ТР-Ф-01' },
    ]);
    expect(diffSpecifications(after, before).changed[0].changes[0]).toMatchObject({
      field: 'requirementIds',
      before: 'ТР-Ф-01',
      after: null,
    });
  });
  it('порядок ID и обновленный код не меняют связь', () => {
    const a = row({ requirementIds: ['req-1', 'req-2'] });
    const b = row({ requirementIds: ['req-2', 'req-1'], requirementCodes: { 'req-1': 'ТР-НОВ' } });
    expect(rowChanged(a, b)).toBe(false);
    expect(diffSpecifications(snap([a]), snap([b], 2)).unchangedCount).toBe(1);
  });
});

describe('связи позиций с требованиями: комплект ГОСТ 34', () => {
  it('варианты из снимка: item и v2, без дублей и пустых ID', () => {
    expect(
      requirementOptionsFromSnapshot({
        requirements: [
          { id: 'req-1', code: 'ТР-Ф-01', title: 'A', category: 'functional', description: 'd' },
          { id: 'req-1', code: 'дубль' },
          { id: '', code: 'пусто' },
          { id: 'v2', title: 'B', originalText: 'исходный текст', approval: { status: 'DRAFT' } },
          'мусор',
        ],
      }),
    ).toEqual([
      { id: 'req-1', code: 'ТР-Ф-01', title: 'A', category: 'functional', description: 'd' },
      { id: 'v2', code: 'v2', title: 'B', category: '', description: 'исходный текст' },
    ]);
    expect(requirementOptionsFromSnapshot(null)).toEqual([]);
    expect(requirementOptionsFromSnapshot({ requirements: 'x' })).toEqual([]);
  });
  it('собирает связанные ID из сырого тела запроса', () => {
    expect(
      linkedRequirementIds([{ requirementIds: ['a', 'b'] }, { requirementIds: ['a', 1] }, null]),
    ).toEqual(['a', 'b']);
    expect(linkedRequirementIds(undefined)).toEqual([]);
  });
  it('неизвестный ID — предупреждение, а не ошибка', () => {
    const items = [
      row({ requirementIds: ['req-1', 'gone'], requirementCodes: { gone: 'ТР-СТАРОЕ' } }),
      row({ id: 'ok', name: 'Без проблем', requirementIds: ['req-2'] }),
    ];
    const warnings = requirementLinkWarnings(items, options);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Сервер СУБД');
    expect(warnings[0]).toContain('ТР-СТАРОЕ');
    expect(warnings[0]).toContain('черновик v2');
    expect(requirementLinkWarnings(items, { source: null, requirements: [] })[0]).toContain(
      'не найден',
    );
  });
  it('коды: из комплекта, для исчезнувших — из прошлой редакции; клиентские не принимаются', () => {
    const previous = snap([
      row({ requirementIds: ['gone'], requirementCodes: { gone: 'ТР-СТАРОЕ' } }),
    ]);
    const next = applyRequirementCodes(
      snap([
        row({
          requirementIds: ['req-1', 'gone', 'forged'],
          requirementCodes: { 'req-1': 'ПОДДЕЛКА', forged: 'ТР-ЛОЖЬ' },
        }),
        row({ id: 'plain', requirementCodes: undefined }),
      ]),
      previous,
      options,
    );
    expect(next.items[0].requirementCodes).toEqual({ 'req-1': 'ТР-Ф-01', gone: 'ТР-СТАРОЕ' });
    expect(next.items[1]).not.toHaveProperty('requirementCodes');
    expect(requirementBasisText(next.items[0])).toBe('ТР-Ф-01, ТР-СТАРОЕ, forged');
    // Результат проходит строгую валидацию снимка.
    expect(() => parseSpecification(next)).not.toThrow();
  });
});

describe('связи позиций с требованиями: выгрузки', () => {
  const linked = row({
    requirementIds: ['req-1', 'req-2'],
    requirementCodes: { 'req-1': 'ТР-Ф-01', 'req-2': 'ТР-ТО-02' },
  });
  it('SPEC DOCX печатает обоснование кодами требований', () => {
    const doc = prepareGost34Document(
      {
        calculation: {
          id: 'c1',
          name: 'Проверка',
          customer: 'Тест',
          stages: [],
          risks: [],
          answers: {},
          specification: snap([linked, row({ id: 'plain', name: 'Без связи' })]),
        },
        metadataOverride: { docType: 'SPEC' },
      },
      { mode: 'preview' },
    );
    const rows = doc.ast.sections.flatMap((s) => s.tables?.flatMap((t) => t.rows) ?? []);
    const basis = rows.map((r) => String(r[7]));
    expect(basis[0]).toBe(
      'КП; Сайзинг; Обоснование: ТР-Ф-01, ТР-ТО-02; Подтверждено пользователем',
    );
    expect(basis[1]).toBe('КП; Сайзинг; Подтверждено пользователем');
  });
  it('SPEC.xlsx содержит графы требований', () => {
    const wb = XLSX.read(
      renderSpecificationXlsx(snap([linked]), { calculationName: 'Р', customer: 'З' }),
      { type: 'buffer' },
    );
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['Спецификация'], { header: 1 });
    const basis = SPEC_XLSX_HEADERS.indexOf('Требования (обоснование)');
    const ids = SPEC_XLSX_HEADERS.indexOf('ID требований');
    expect(basis).toBeGreaterThan(0);
    expect(rows[1][basis]).toBe('ТР-Ф-01, ТР-ТО-02');
    expect(rows[1][ids]).toBe('req-1, req-2');
  });
});
