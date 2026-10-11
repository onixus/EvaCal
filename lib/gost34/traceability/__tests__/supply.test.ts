import { describe, expect, it } from 'vitest';
import { generateTraceabilityTable } from '../engine';
import { buildFullTraceabilityMatrix } from '../matrix';
import { buildRequirementSupplyIndex, supplyItemsText } from '../supply';
import type { Gost34RequirementItem, Gost34StageItem } from '../../types';
import type { SpecificationItem } from '../../../specification/types';
import { prepareGost34Document } from '../../generation/prepareDocument';

const requirements: Gost34RequirementItem[] = [
  { id: 'req-1', code: 'ТР-01', category: 'hardware_pac', title: 'Серверы СУБД', description: 'x' },
  { id: 'req-2', code: 'ТР-02', category: 'functional', title: 'Отчеты', description: 'y' },
];
const stages: Gost34StageItem[] = [
  { id: 'st-1', order: 1, name: 'Поставка оборудования', role: 'engineer', hours: 8 },
];
const item = (over: Partial<SpecificationItem>): SpecificationItem => ({
  id: 'i',
  kind: 'hardware',
  disposition: 'supply',
  name: 'Сервер',
  vendor: 'Vendor',
  sku: 'SRV-1',
  quantity: '2',
  unit: 'шт.',
  configuration: '',
  licensing: '',
  term: '',
  source: 'КП',
  rationale: 'Сайзинг',
  confirmed: true,
  unitPrice: null,
  currency: 'RUB',
  ...over,
});
const items = [
  item({ id: 'srv', requirementIds: ['req-1'] }),
  item({
    id: 'old',
    name: 'Имеющаяся СХД',
    sku: '',
    quantity: null,
    disposition: 'existing',
    requirementIds: ['req-1', 'gone'],
  }),
  item({ id: 'free', name: 'Без связи' }),
];

describe('трассировка «требование → позиции спецификации»', () => {
  it('индекс по ID требования в порядке строк', () => {
    const index = buildRequirementSupplyIndex(items);
    expect(index.get('req-1')?.map((s) => s.itemId)).toEqual(['srv', 'old']);
    expect(index.get('gone')?.map((s) => s.itemId)).toEqual(['old']);
    expect(index.has('req-2')).toBe(false);
    expect(supplyItemsText(index.get('req-1')!)).toBe(
      'Сервер (Vendor / SRV-1), 2 шт.; Имеющаяся СХД (Vendor), кол-во неизвестно — Используем имеющееся',
    );
    // Сырой (непроверенный) снимок не ломает индекс.
    expect(buildRequirementSupplyIndex([{ requirementIds: 'req-1' } as never]).size).toBe(0);
    expect(buildRequirementSupplyIndex(undefined).size).toBe(0);
  });

  it('таблица ТЗ: графа появляется только при наличии связей', () => {
    const plain = generateTraceabilityTable(requirements, stages);
    expect(plain.headers).not.toContain('Позиции спецификации');
    expect(generateTraceabilityTable(requirements, stages, undefined, [items[2]]).headers).toEqual(
      plain.headers,
    );
    const linked = generateTraceabilityTable(requirements, stages, undefined, items);
    expect(linked.headers.at(-1)).toBe('Позиции спецификации');
    expect(linked.rows[0].at(-1)).toContain('Сервер (Vendor / SRV-1), 2 шт.');
    expect(linked.rows[1].at(-1)).toBe('—');
    expect(linked.rows[0].slice(0, -1)).toEqual(plain.rows[0]);
  });

  it('матрица прослеживаемости показывает обеспечивающие позиции', () => {
    const matrix = buildFullTraceabilityMatrix(requirements, stages, {}, [], [], items);
    expect(matrix.items.find((i) => i.id === 'req-1')?.supplyItems.map((s) => s.itemId)).toEqual([
      'srv',
      'old',
    ]);
    expect(matrix.items.find((i) => i.id === 'req-2')?.supplyItems).toEqual([]);
    expect(buildFullTraceabilityMatrix(requirements, stages).items[0].supplyItems).toEqual([]);
  });

  it('ТЗ печатает позиции спецификации в матрице прослеживаемости', () => {
    const doc = prepareGost34Document(
      {
        calculation: {
          id: 'c1',
          name: 'Проверка',
          customer: 'Тест',
          answers: {},
          stages: [{ name: 'Поставка оборудования', role: 'engineer', hours: 8 }],
          risks: [],
          specification: {
            version: 1,
            status: 'draft',
            emptySupplyReason: '',
            items: [item({ id: 'srv', requirementIds: ['req-1'] })],
          },
        },
        rawRequirements: requirements,
        metadataOverride: { docType: 'TZ' },
      },
      { mode: 'preview' },
    );
    const table = doc.ast.sections
      .flatMap((s) => s.tables ?? [])
      .find((t) => t.headers.includes('Позиции спецификации'));
    expect(table).toBeDefined();
    const row = table!.rows.find((r) => r[0] === 'ТР-01');
    expect(row?.at(-1)).toContain('Сервер (Vendor / SRV-1), 2 шт.');
  });
});
