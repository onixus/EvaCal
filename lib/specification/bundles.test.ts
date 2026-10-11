import { describe, expect, it } from 'vitest';
import type { SpecificationItem } from './types';
import { parseSpecification, specificationBlockers } from './validation';
import { summarizeSpecification } from './totals';
import { specificationXlsxRows } from './xlsx';
import { diffSpecifications } from './diff';
import { specificationSections } from './sections';

const row = (id: string, patch: Partial<SpecificationItem> = {}): SpecificationItem => ({
  id,
  kind: 'hardware',
  disposition: 'supply',
  name: id,
  vendor: '',
  sku: '',
  quantity: '1',
  unit: 'шт.',
  configuration: '',
  licensing: '',
  term: '',
  source: 's',
  rationale: 'r',
  confirmed: true,
  unitPrice: '1',
  currency: 'RUB',
  ...patch,
});
const spec = (items: unknown[]) => ({ version: 0, status: 'draft', emptySupplyReason: '', items });
const bundle = row('kit', { kind: 'bundle', name: 'Комплект', unit: 'компл.', unitPrice: '1000' });

describe('Комплекты в итогах (правило 3a totals.ts)', () => {
  it('состав комплекта не суммируется: цену несет строка комплекта', () => {
    const totals = summarizeSpecification({
      items: [
        bundle,
        row('srv', { includedIn: 'kit', unitPrice: '800' }),
        row('lic', { kind: 'license', includedIn: 'kit', unitPrice: '300', currency: 'USD' }),
        row('extra', { unitPrice: '5' }),
      ],
    });
    expect(totals).toEqual([
      { currency: 'RUB', total: '1005', unknownCount: 0, includedCount: 2, incomplete: false },
    ]);
  });
  it('неизвестная цена комплекта делает итог неполным даже при известных ценах состава', () => {
    const [total] = summarizeSpecification({
      items: [{ ...bundle, unitPrice: null }, row('srv', { includedIn: 'kit', unitPrice: '800' })],
    });
    expect(total).toMatchObject({ total: '0', unknownCount: 1, incomplete: true });
  });
  it('компонент без цены не делает итог неполным', () => {
    const [total] = summarizeSpecification({
      items: [bundle, row('srv', { includedIn: 'kit', unitPrice: null })],
    });
    expect(total).toMatchObject({ total: '1000', incomplete: false, includedCount: 1 });
  });
  it('XLSX не показывает сумму компонента; diff видит изменение состава', () => {
    const items = [bundle, row('srv', { includedIn: 'kit', unitPrice: '800' })];
    const amounts = specificationXlsxRows({ ...parseSpecification(spec(items)) }).map((r) => r[14]);
    expect(amounts).toEqual(['в составе комплекта', 1000]);
    const before = parseSpecification({ ...spec(items), version: 1 });
    const after = parseSpecification({
      ...spec([bundle, row('srv', { unitPrice: '800' })]),
      version: 2,
    });
    expect(diffSpecifications(before, after).changed[0].changes).toEqual([
      { field: 'includedIn', before: 'kit', after: null },
    ]);
  });
});

describe('Новые типы и состав комплекта', () => {
  it('subscription и bundle допустимы, разделы SPEC их включают; includedIn сохраняется', () => {
    const parsed = parseSpecification(
      spec([bundle, row('sub', { kind: 'subscription', includedIn: 'kit', licensing: '1 год' })]),
    );
    expect(parsed.items.map((i) => [i.kind, i.includedIn])).toEqual([
      ['bundle', undefined],
      ['subscription', 'kit'],
    ]);
    const sections = specificationSections(parsed.items);
    expect(sections.flatMap((s) => s.items.map((i) => `${s.num}:${i.id}`)).sort()).toEqual([
      '2:sub',
      '4:kit',
    ]);
  });
  it('includedIn должен указывать на строку-комплект этой спецификации', () => {
    expect(() => parseSpecification(spec([{ ...bundle, includedIn: 'kit' }]))).toThrow();
    expect(() => parseSpecification(spec([row('x', { includedIn: 'missing' })]))).toThrow(
      /комплект/,
    );
    expect(() => parseSpecification(spec([row('hw'), row('x', { includedIn: 'hw' })]))).toThrow(
      /комплект/,
    );
    expect(() =>
      parseSpecification(spec([bundle, { ...bundle, id: 'kit2', includedIn: 'kit' }])),
    ).toThrow(/вложенные/);
  });
  it('подписка требует модель лицензирования для выпуска', () => {
    const parsed = parseSpecification(spec([row('s', { kind: 'subscription' })]));
    expect(specificationBlockers({ ...parsed, status: 'confirmed' }).join('\n')).toMatch(
      /лицензирования/,
    );
  });
});
