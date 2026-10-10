import { describe, expect, it } from 'vitest';
import {
  applyProposedChanges,
  computeBaseFingerprint,
  matchStageIds,
  type FingerprintInput,
} from './apply';

const stage = (id: string, order: number, name = `Этап ${order}`) => ({
  id,
  name,
  role: 'engineer',
  order,
  isApprovalTask: false,
});

describe('matchStageIds', () => {
  it('сопоставляет клоны по порядку, названию и роли; повторы — по вхождению', () => {
    const base = [stage('a', 0, 'Проект'), stage('b', 1, 'Работы'), stage('c', 1, 'Работы')];
    const next = [stage('x', 1, 'Работы'), stage('y', 0, 'Проект'), stage('z', 1, 'Работы')];
    expect(Object.fromEntries(matchStageIds(base, next))).toEqual({ a: 'y', b: 'x', c: 'z' });
  });
  it('несовпавший этап не попадает в карту', () => {
    expect(matchStageIds([stage('a', 0)], [stage('x', 0, 'Другое')]).size).toBe(0);
  });
});

describe('applyProposedChanges', () => {
  const snapshot = {
    standardProfileId: 'ru-gost34-current',
    requirements: [
      { id: 'R1', code: 'ТР-01', description: 'Вход по паролю', normalizedBy: 'llm' },
      { id: 'R2', code: 'ТР-02', description: 'Журнал', mappedStageId: 'S2' },
      { id: 'R3', code: 'ТР-03', description: 'Отчёты' },
      {
        id: 'V1',
        code: 'ТР-10',
        title: 'v2',
        originalText: 'старое',
        normalizedText: 'норма',
        approval: { status: 'APPROVED' },
      },
    ],
    manualLinks: [
      { sourceId: 'R1', targetId: 'S1', method: 'MANUAL', approved: true },
      { sourceId: 'R3', targetId: 'S2', method: 'MANUAL', approved: true },
      { sourceId: 'R2', targetId: '', method: 'MANUAL', approved: true },
      { sourceId: 'V1', targetStageId: 'S-gone' },
    ],
  };
  const map = new Map([
    ['S1', 'N1'],
    ['S2', 'N2'],
  ]);
  const proposed = {
    summary: 'SSO',
    items: [
      { kind: 'modify' as const, requirementId: 'R1', text: 'Вход через SAML' },
      { kind: 'modify' as const, requirementId: 'V1', text: 'новое' },
      { kind: 'remove' as const, requirementId: 'R3', text: '' },
      { kind: 'add' as const, requirementId: null, text: 'Журнал входов SSO' },
    ],
  };

  it('правит, исключает и добавляет требования; база не мутируется', () => {
    const before = JSON.stringify(snapshot);
    const res = applyProposedChanges(snapshot, proposed, 'ИЗМ-02', map, new Date(0));
    expect(JSON.stringify(snapshot)).toBe(before);
    expect(res).toMatchObject({ modified: 2, removed: 1, added: 1 });
    const reqs = res.snapshot.requirements as Array<Record<string, unknown>>;
    expect(reqs.map((r) => r.id)).toEqual(['R1', 'R2', 'V1', 'ИЗМ-02-1']);
    expect(reqs[0]).toEqual({
      id: 'R1',
      code: 'ТР-01',
      description: 'Вход через SAML',
      originalText: 'Вход через SAML',
      changeRef: 'ИЗМ-02',
    });
    // legacy-привязка перенесена на этап новой версии
    expect(reqs[1].mappedStageId).toBe('N2');
    // v2: новая исходная редакция, нормализация сброшена, снова черновик
    expect(reqs[2]).toMatchObject({ originalText: 'новое', approval: { status: 'DRAFT' } });
    expect(reqs[2]).not.toHaveProperty('normalizedText');
    expect(reqs[3]).toMatchObject({ code: 'ИЗМ-02.1', description: 'Журнал входов SSO' });
    expect(res.snapshot.standardProfileId).toBe('ru-gost34-current');
  });

  it('связи: исключённые удалены, цели перенесены, «не распределено» сохранено, потерянные отброшены', () => {
    const res = applyProposedChanges(snapshot, proposed, 'ИЗМ-02', map);
    expect(res.snapshot.manualLinks).toEqual([
      { sourceId: 'R1', targetId: 'N1', method: 'MANUAL', approved: true },
      { sourceId: 'R2', targetId: '', method: 'MANUAL', approved: true },
    ]);
  });

  it('пустой снимок — только новые требования', () => {
    const res = applyProposedChanges(null, proposed, 'ИЗМ-01', new Map());
    expect((res.snapshot.requirements as unknown[]).length).toBe(1);
    expect(res.snapshot.manualLinks).toEqual([]);
  });
});

describe('computeBaseFingerprint', () => {
  const input: FingerprintInput = {
    calculation: {
      pmHours: 16,
      currency: 'RUB',
      pricingMode: 'markup',
      roleRates: null,
      overheadPercent: 0,
      marginPercent: 20,
      discountPercent: 0,
      vatPercent: 20,
      includeVat: true,
      stages: [
        {
          id: 'S1',
          name: 'A',
          role: 'r',
          hours: 10,
          order: 0,
          isApprovalTask: false,
          requirements: null,
        },
        {
          id: 'S2',
          name: 'B',
          role: 'r',
          hours: 20,
          order: 1,
          isApprovalTask: false,
          requirements: null,
        },
      ],
      risks: [{ description: 'риск', hours: 5, order: 0 }],
    },
    basePackage: { snapshot: '{"requirements":[]}', documentTypes: '["tz"]' },
  };
  const fp = computeBaseFingerprint(input);

  it('не зависит от порядка выборки строк', () => {
    const reordered = {
      ...input,
      calculation: { ...input.calculation, stages: [...input.calculation.stages].reverse() },
    };
    expect(computeBaseFingerprint(reordered)).toBe(fp);
  });
  it('меняется от часов, рисков, ставок и снимка комплекта', () => {
    const c = input.calculation;
    const variants: FingerprintInput[] = [
      { ...input, calculation: { ...c, stages: [{ ...c.stages[0], hours: 11 }, c.stages[1]] } },
      { ...input, calculation: { ...c, risks: [] } },
      { ...input, calculation: { ...c, marginPercent: 25 } },
      { ...input, basePackage: { snapshot: '{"requirements":[1]}', documentTypes: '["tz"]' } },
      { ...input, basePackage: null },
    ];
    for (const v of variants) expect(computeBaseFingerprint(v)).not.toBe(fp);
  });
});
