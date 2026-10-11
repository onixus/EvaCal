import { describe, it, expect } from 'vitest';
import { prepareGost34Document } from '../generation/prepareDocument';
import { withoutClientEvidence } from '../generation/clientEvidence';
import { businessDate } from '../../catalog/business-date';
import type { EvidenceLive, EvidenceSnapshot } from '../../catalog/compliance';
import type { SpecificationItem, SpecificationSnapshot } from '../../specification/types';

const today = businessDate(new Date())!;
const evidence = (patch: Partial<EvidenceSnapshot> = {}): EvidenceSnapshot => ({
  id: 'ev-1',
  revision: 1,
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
const origin = (sku: string, edition = '') => ({
  vendorId: 'v',
  vendorName: 'Вендор',
  productId: 'p1',
  productRevision: 1,
  offerId: null,
  sku,
  edition,
  import: null,
  baseline: {
    name: 'СУБД',
    kind: 'software',
    unit: 'лиц.',
    configuration: '',
    licensing: 'Бессрочная',
    term: '',
    source: 'Каталог',
    unitPrice: null,
    currency: 'RUB',
  },
});
const base: SpecificationItem = {
  id: 'sw-1',
  origin: origin('DB-1'),
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
      evidence: [evidence({ id: 'ev-2', validUntil: '2000-01-01' })],
    },
    {
      ...base,
      id: 'sw-other',
      name: 'СУБД другой версии',
      origin: origin('DB-2'),
      sku: 'DB-2',
    },
    {
      ...base,
      id: 'sw-edited',
      name: 'СУБД с артикулом, измененным вручную',
      sku: 'DB-1-CUSTOM',
    },
    {
      ...base,
      id: 'sw-brand',
      name: 'Брендовая СУБД без подтверждений',
      origin: undefined,
      evidence: undefined,
    },
    {
      ...base,
      id: 'sw-stale',
      name: 'СУБД с устаревшей проверкой',
      evidence: [evidence({ id: 'ev-3', checkedAt: '2000-01-01' })],
    },
    {
      ...base,
      id: 'sw-existing',
      name: 'Имеющаяся СУБД',
      disposition: 'existing',
      evidence: undefined,
    },
  ],
};
const prepare = (
  docType: 'PZ' | 'SPEC',
  snapshot: SpecificationSnapshot = spec,
  evidenceLive?: EvidenceLive,
) =>
  prepareGost34Document(
    {
      calculation: {
        id: 'c1',
        name: 'Проверка',
        customer: 'Тест',
        stages: [],
        risks: [],
        answers: {},
        specification: snapshot,
        ...(evidenceLive ? { evidenceLive } : {}),
      },
      metadataOverride: { docType },
    },
    { mode: 'export' },
  );
const evidenceColumn = (docType: 'PZ' | 'SPEC') => {
  const result = prepare(docType);
  const rows = new Map<string, string>();
  for (const table of result.ast.sections.flatMap((s) => s.tables || [])) {
    const col = table.headers.findIndex((h) => /Реестр/.test(h));
    const nameCol = table.headers.findIndex((h) => /Наименование|Программное средство/.test(h));
    if (col < 0 || nameCol < 0) continue;
    for (const row of table.rows) rows.set(String(row[nameCol]), String(row[col]));
  }
  return { rows, result };
};

describe.each(['PZ', 'SPEC'] as const)('%s: подтверждения соответствия', (docType) => {
  it('печатает только действующее подтверждение точной версии каталожной позиции', () => {
    const { rows, result } = evidenceColumn(docType);
    expect(rows.get('СУБД с записью реестра')).toMatch(/Реестр российского ПО № 369/);
    for (const name of [
      'СУБД с истекшей записью',
      'СУБД другой версии',
      'СУБД с артикулом, измененным вручную',
      'Брендовая СУБД без подтверждений',
      'СУБД с устаревшей проверкой',
      'Имеющаяся СУБД',
    ])
      expect(rows.get(name)).toBe('Не подтверждено');
    const gap = result.diagnostics.gaps.find((g) => g.path === 'specification.evidence');
    expect(gap).toMatchObject({ severity: 'minor' });
    // Only supplied rows: the existing DBMS is not demanded evidence.
    expect(gap?.label).toMatch(/5 поз\./);
    expect(gap?.label).not.toMatch(/Имеющаяся|СУБД с записью реестра/);
    expect(gap?.hint).toMatch(/Обновить сведения реестров/);
  });
  it('пробелы подтверждений не блокируют экспорт', () => {
    expect(prepare(docType).diagnostics.issues).toEqual([]);
  });
  it('для невыпущенной редакции расхождение копии с каталогом — отдельный пробел', () => {
    const live: EvidenceLive = {
      'ev-1': { revision: 2, archived: false },
      'ev-2': { revision: 1, archived: true },
      'ev-3': { revision: 1, archived: false },
    };
    const drift = prepare(docType, spec, live).diagnostics.gaps.find(
      (g) => g.path === 'specification.evidence-drift',
    );
    expect(drift?.label).toMatch(/СУБД с записью реестра/);
    expect(drift?.label).toMatch(/СУБД с истекшей записью/);
    expect(drift?.label).not.toMatch(/устаревшей/);
    const same = prepare(docType, spec, {
      'ev-1': { revision: 1, archived: false },
      'ev-2': { revision: 1, archived: false },
      'ev-3': { revision: 1, archived: false },
    });
    expect(same.diagnostics.gaps.map((g) => g.path)).not.toContain('specification.evidence-drift');
  });
});

describe('Генерация из данных клиента', () => {
  it('отбрасывает присланные клиентом копии подтверждений и живое состояние', () => {
    const cleaned = withoutClientEvidence({
      id: 'c1',
      evidenceLive: { 'ev-1': { revision: 1, archived: false } },
      specification: spec,
    });
    expect('evidenceLive' in cleaned).toBe(false);
    expect(cleaned.specification.items.every((i) => i.evidence === undefined)).toBe(true);
    expect(withoutClientEvidence(undefined)).toBeUndefined();
  });
});
