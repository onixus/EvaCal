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
      title: 'Вход через SAML',
    });
    // legacy-привязка перенесена на этап новой версии
    expect(reqs[1].mappedStageId).toBe('N2');
    // v2: новая исходная редакция, нормализация сброшена, снова черновик
    expect(reqs[2]).toMatchObject({ originalText: 'новое', approval: { status: 'DRAFT' } });
    expect(reqs[2]).not.toHaveProperty('normalizedText');
    expect(reqs[3]).toMatchObject({ code: 'ИЗМ-02.1', description: 'Журнал входов SSO' });
    expect(res.snapshot.standardProfileId).toBe('ru-gost34-current');
    // Подписи и автор ТЗ — от выпуска базы; черновик подписывают заново.
    const signed = applyProposedChanges(
      { ...snapshot, signatures: { a: 'b' }, tzAuthor: { x: 1 }, activeStep: 'review' },
      proposed,
      'ИЗМ-02',
      map,
    );
    expect(signed.snapshot).not.toHaveProperty('signatures');
    expect(signed.snapshot).not.toHaveProperty('tzAuthor');
    expect(signed.snapshot).not.toHaveProperty('activeStep');
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
  const stageRow = (id: string, name: string, hours: number, order: number) => ({
    id,
    name,
    role: 'r',
    hours,
    order,
    isApprovalTask: false,
    requirements: null,
    parallel: false,
    approvalDays: null as number | null,
  });
  const snapshot = {
    requirements: [{ id: 'R1', description: 'Вход' }],
    manualLinks: [],
    signatures: { approver: 'Иванов' },
    tzAuthor: { mode: 'manual' },
    activeStep: 'review',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
  const input: FingerprintInput = {
    calculation: {
      startDate: new Date('2026-11-02T00:00:00Z'),
      pmHours: 16,
      currency: 'RUB',
      pricingMode: 'markup',
      roleRates: null,
      overheadPercent: 0,
      marginPercent: 20,
      discountPercent: 0,
      vatPercent: 20,
      includeVat: true,
      stages: [stageRow('S1', 'A', 10, 0), stageRow('S2', 'B', 20, 1)],
      risks: [{ description: 'риск', hours: 5, order: 0 }],
      dependencies: [{ fromStageId: 'S1', toStageId: 'S2', type: 'FS', lagDays: 0 }],
    },
    basePackage: { snapshot: JSON.stringify(snapshot), documentTypes: '["tz"]' },
  };
  const fp = computeBaseFingerprint(input);
  const c = input.calculation;
  const withSnapshot = (value: unknown): FingerprintInput => ({
    ...input,
    basePackage: { snapshot: JSON.stringify(value), documentTypes: '["tz"]' },
  });

  it('не зависит от порядка выборки строк и ключей снимка', () => {
    const reordered: FingerprintInput = {
      ...input,
      calculation: { ...c, stages: [...c.stages].reverse() },
    };
    expect(computeBaseFingerprint(reordered)).toBe(fp);
    const reversedKeys = Object.fromEntries(Object.entries(snapshot).reverse());
    expect(computeBaseFingerprint(withSnapshot(reversedKeys))).toBe(fp);
  });

  it('подписи, автор ТЗ, шаг мастера и метка сохранения снимка не влияют', () => {
    expect(
      computeBaseFingerprint(
        withSnapshot({
          ...snapshot,
          signatures: { approver: 'Петров' },
          tzAuthor: null,
          activeStep: 'export',
          updatedAt: '2026-10-11T00:00:00.000Z',
        }),
      ),
    ).toBe(fp);
  });

  it('меняется от часов, рисков, ставок и содержания комплекта', () => {
    const variants: FingerprintInput[] = [
      { ...input, calculation: { ...c, stages: [{ ...c.stages[0], hours: 11 }, c.stages[1]] } },
      { ...input, calculation: { ...c, risks: [] } },
      { ...input, calculation: { ...c, marginPercent: 25 } },
      withSnapshot({ ...snapshot, requirements: [{ id: 'R1', description: 'Вход по SSO' }] }),
      withSnapshot({ ...snapshot, sectionOverrides: { intro: { title: 'Новое' } } }),
      withSnapshot({ ...snapshot, projectContext: { users: 500 } }),
      { ...input, basePackage: null },
    ];
    for (const v of variants) expect(computeBaseFingerprint(v)).not.toBe(fp);
  });

  it('меняется от входов Ганта: параллельность, срок согласования, старт, зависимости', () => {
    const variants: FingerprintInput[] = [
      {
        ...input,
        calculation: { ...c, stages: [{ ...c.stages[0], parallel: true }, c.stages[1]] },
      },
      {
        ...input,
        calculation: { ...c, stages: [{ ...c.stages[0], approvalDays: 5 }, c.stages[1]] },
      },
      { ...input, calculation: { ...c, startDate: new Date('2026-11-09T00:00:00Z') } },
      { ...input, calculation: { ...c, dependencies: [] } },
      {
        ...input,
        calculation: {
          ...c,
          dependencies: [{ fromStageId: 'S1', toStageId: 'S2', type: 'FS', lagDays: 3 }],
        },
      },
    ];
    for (const v of variants) expect(computeBaseFingerprint(v)).not.toBe(fp);
  });
});
