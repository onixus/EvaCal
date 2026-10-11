import { describe, it, expect } from 'vitest';
import { prepareGost34Document } from '../generation/prepareDocument';
import { businessDate } from '../../catalog/business-date';
import type { EvidenceSnapshot } from '../../catalog/compliance';
import type { SpecificationItem, SpecificationSnapshot } from '../../specification/types';

const today = businessDate(new Date())!;
const evidence = (patch: Partial<EvidenceSnapshot> = {}): EvidenceSnapshot => ({
  id: 'ev-1',
  productId: 'p1',
  productRevision: 1,
  type: 'software_registry',
  number: '369',
  issuer: 'Минцифры России',
  sourceUrl: 'https://reestr.example/369',
  checkedAt: today,
  checkedBy: 'u1',
  validUntil: null,
  status: 'confirmed',
  applicability: 'DB-1',
  ...patch,
});
const base: SpecificationItem = {
  id: 'sw-1',
  kind: 'software',
  disposition: 'supply',
  name: 'СУБД с записью реестра',
  vendor: 'Вендор',
  sku: 'DB-1',
  quantity: '2',
  unit: 'лиц.',
  configuration: '',
  licensing: 'Бессрочная',
  term: '',
  source: 'КП',
  rationale: 'Выбор Заказчика',
  confirmed: true,
  unitPrice: '1',
  currency: 'RUB',
  evidence: [evidence()],
};
const spec: SpecificationSnapshot = {
  version: 2,
  status: 'confirmed',
  emptySupplyReason: '',
  items: [
    base,
    {
      ...base,
      id: 'sw-exp',
      name: 'СУБД с истекшей записью',
      evidence: [evidence({ validUntil: '2000-01-01' })],
    },
    {
      ...base,
      id: 'sw-other',
      name: 'СУБД другой версии',
      sku: 'DB-2',
      evidence: [evidence()],
    },
    { ...base, id: 'sw-brand', name: 'Брендовая СУБД без подтверждений', evidence: undefined },
    {
      ...base,
      id: 'sw-stale',
      name: 'СУБД с устаревшей проверкой',
      evidence: [evidence({ checkedAt: '2000-01-01' })],
    },
  ],
};
const prepare = (docType: 'PZ' | 'SPEC') =>
  prepareGost34Document(
    {
      calculation: {
        id: 'c1',
        name: 'Проверка',
        customer: 'Тест',
        stages: [],
        risks: [],
        answers: {},
        specification: spec,
      },
      metadataOverride: { docType },
    },
    { mode: 'export' },
  );
const evidenceColumn = (docType: 'PZ' | 'SPEC') => {
  const result = prepare(docType);
  const tables = result.ast.sections.flatMap((s) => [
    ...(s.tables || []),
    ...(s.subsections || []).flatMap((sub) => sub.tables || []),
  ]);
  const rows = new Map<string, string>();
  for (const table of tables) {
    const col = table.headers.findIndex((h) => /Реестр/.test(h));
    const nameCol = table.headers.findIndex((h) => /Наименование|Программное средство/.test(h));
    if (col < 0 || nameCol < 0) continue;
    for (const row of table.rows) rows.set(String(row[nameCol]), String(row[col]));
  }
  return { rows, result };
};

describe.each(['PZ', 'SPEC'] as const)('%s: подтверждения соответствия', (docType) => {
  it('печатает только действующее подтверждение точной версии подтвержденной позиции', () => {
    const { rows, result } = evidenceColumn(docType);
    expect(rows.get('СУБД с записью реестра')).toMatch(/Реестр российского ПО № 369/);
    for (const name of [
      'СУБД с истекшей записью',
      'СУБД другой версии',
      'Брендовая СУБД без подтверждений',
      'СУБД с устаревшей проверкой',
    ])
      expect(rows.get(name)).toBe('Не подтверждено');
    const gap = result.diagnostics.gaps.find((g) => g.path === 'specification.evidence');
    expect(gap).toMatchObject({ severity: 'minor' });
    expect(gap?.label).toMatch(/4 поз\./);
    expect(gap?.label).not.toMatch(/СУБД с записью реестра/);
  });
  it('пробел подтверждений не блокирует экспорт', () => {
    expect(prepare(docType).diagnostics.issues).toEqual([]);
  });
});
