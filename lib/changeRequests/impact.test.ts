import { describe, expect, it } from 'vitest';
import {
  computeChangeImpact,
  requirementsFromSnapshot,
  snapshotAffectedRequirements,
  traceLinksFromSnapshot,
} from './impact';

const snapshot = {
  requirements: [
    {
      id: 'R1',
      code: 'ТР-01',
      title: 'Аутентификация',
      description: 'Вход по паролю',
      criterion: 'Вход проходит; неверный пароль отклоняется',
    },
    {
      id: 'R2',
      code: 'ТР-02',
      title: 'Журнал',
      description: 'Журнал событий',
      mappedStageId: 'S2',
    },
    { id: 'R3', code: 'ТР-03', title: 'Отчёты', description: 'Отчёты' },
    {
      id: 'R4',
      code: 'ТР-04',
      title: 'Копии',
      description: 'Ежедневные копии (нормализовано)',
      originalText: 'Копии раз в день',
    },
  ],
  manualLinks: [
    { sourceId: 'R1', targetId: 'S1', method: 'MANUAL', approved: true },
    { sourceId: 'R3', targetId: '', method: 'MANUAL', approved: true }, // «не распределено»
  ],
};

const stages = [
  { id: 'S1', name: 'Проектирование', role: 'architect', hours: 120, order: 0 },
  { id: 'S2', name: 'Разработка', role: 'engineer', hours: 400, order: 1 },
  { id: 'S3', name: 'Внедрение', role: 'engineer', hours: 80, order: 2 },
];

const base = {
  calculation: { id: 'c1', version: 2, currency: 'RUB' },
  stages,
  basePackage: { id: 'p1', version: 3, documentTypes: ['TZ', 'pmi', 'tz'], snapshot },
  now: new Date('2026-10-10T00:00:00Z'),
};

describe('requirementsFromSnapshot', () => {
  it('текст — действующая редакция: неутверждённая нормализация не подменяет исходник', () => {
    expect(requirementsFromSnapshot(snapshot)).toEqual([
      { id: 'R1', code: 'ТР-01', text: 'Вход по паролю' },
      { id: 'R2', code: 'ТР-02', text: 'Журнал событий' },
      { id: 'R3', code: 'ТР-03', text: 'Отчёты' },
      // description отличается от originalText → normalizedText, но требование DRAFT.
      { id: 'R4', code: 'ТР-04', text: 'Копии раз в день' },
    ]);
  });
  it('утверждённое v2-требование показывается нормализованным', () => {
    const v2 = {
      requirements: [
        {
          id: 'V1',
          code: 'ТР-10',
          title: 't',
          category: 'functional',
          type: 'system',
          originalText: 'исходник',
          normalizedText: 'норма',
          approval: { status: 'APPROVED' },
        },
      ],
    };
    expect(requirementsFromSnapshot(v2)).toEqual([{ id: 'V1', code: 'ТР-10', text: 'норма' }]);
  });
  it('пустой или битый снимок — пустой список', () => {
    expect(requirementsFromSnapshot(null)).toEqual([]);
    expect(requirementsFromSnapshot({ requirements: 'x' })).toEqual([]);
  });
  it('неизвестные id возвращаются отдельно', () => {
    const res = snapshotAffectedRequirements(snapshot, ['R2', 'X9']);
    expect(res.requirements.map((r) => r.id)).toEqual(['R2']);
    expect(res.unknownIds).toEqual(['X9']);
  });
});

describe('traceLinksFromSnapshot — тот же движок, что и выпуск', () => {
  const pairs = (snap: unknown, st = stages) =>
    traceLinksFromSnapshot(snap, st).map((l) => [l.sourceId, l.targetId, l.method]);

  it('ручная перепривязка главнее legacy mappedStageId', () => {
    const snap = {
      requirements: [{ id: 'R2', code: 'ТР-02', description: 'Журнал', mappedStageId: 'S2' }],
      manualLinks: [{ sourceId: 'R2', targetId: 'S3', method: 'MANUAL', approved: true }],
    };
    expect(pairs(snap)).toEqual([['R2', 'S3', 'MANUAL']]);
  });

  it('«намеренно не распределено» главнее mappedStageId и правил', () => {
    const snap = {
      requirements: [
        {
          id: 'R5',
          code: 'ТР-05',
          description: 'Интеграция с 1С через REST API',
          mappedStageId: 'S2',
        },
      ],
      manualLinks: [{ sourceId: 'R5', targetId: '', method: 'MANUAL', approved: true }],
    };
    expect(
      pairs(snap, [...stages, { id: 'S4', name: 'Интеграция', role: 'x', hours: 1, order: 3 }]),
    ).toEqual([]);
  });

  it('legacy mappedStageId — запасной вариант без ручного решения', () => {
    expect(pairs(snapshot)).toContainEqual(['R2', 'S2', 'MANUAL']);
  });

  it('комплект без manualLinks показывает этапы, найденные правилами', () => {
    const snap = {
      requirements: [{ id: 'R5', code: 'ТР-05', description: 'Интеграция с 1С через REST API' }],
    };
    // Правило интеграций движка выбирает первый подходящий этап — «Разработка»,
    // как и в трассировке выпущенного комплекта.
    expect(pairs(snap)).toEqual([['R5', 'S2', 'RULE']]);
    const impact = computeChangeImpact({
      ...base,
      basePackage: { ...base.basePackage, snapshot: snap },
      requirementIds: ['R5'],
    });
    expect(impact.stages).toEqual([
      {
        id: 'S2',
        name: 'Разработка',
        role: 'engineer',
        baseHours: 400,
        requirementIds: ['R5'],
        ruleRequirementIds: ['R5'],
      },
    ]);
    expect(impact.unlinkedRequirementIds).toEqual([]);
  });
});

describe('computeChangeImpact', () => {
  it('перечисляет связанные этапы с часами как контекст, документы и критерии', () => {
    const impact = computeChangeImpact({ ...base, requirementIds: ['R1', 'R2', 'R3'] });
    expect(impact.stages).toEqual([
      {
        id: 'S1',
        name: 'Проектирование',
        role: 'architect',
        baseHours: 120,
        requirementIds: ['R1'],
        ruleRequirementIds: [],
      },
      {
        id: 'S2',
        name: 'Разработка',
        role: 'engineer',
        baseHours: 400,
        requirementIds: ['R2'],
        ruleRequirementIds: [],
      },
    ]);
    expect(impact.documents.map((d) => d.type)).toEqual(['tz', 'pmi']);
    expect(impact.checks.map((c) => c.criterion)).toEqual([
      'Вход проходит',
      'неверный пароль отклоняется',
    ]);
    expect(impact.unlinkedRequirementIds).toEqual(['R3']);
    expect(impact.base).toEqual({
      calculationId: 'c1',
      calculationVersion: 2,
      currency: 'RUB',
      packageId: 'p1',
      packageVersion: 3,
    });
  });

  it('не суммирует часы связанных этапов и не предлагает оценку', () => {
    const impact = computeChangeImpact({ ...base, requirementIds: ['R1', 'R2'] });
    // Никаких итогов: ни часов, ни стоимости, ни срока — их вводит специалист.
    const keys = new Set<string>();
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object')
        for (const [k, val] of Object.entries(v)) {
          keys.add(k);
          walk(val);
        }
    };
    walk(impact);
    for (const forbidden of [
      'hours',
      'totalHours',
      'estimatedHours',
      'cost',
      'scheduleDays',
      'confirmedHours',
    ]) {
      expect(keys.has(forbidden)).toBe(false);
    }
    // Числа — только справочные часы этапов и номера версий.
    const numbers: number[] = [];
    const collect = (v: unknown) => {
      if (typeof v === 'number') numbers.push(v);
      else if (Array.isArray(v)) v.forEach(collect);
      else if (v && typeof v === 'object') Object.values(v).forEach(collect);
    };
    collect(impact);
    expect(numbers).not.toContain(520); // 120 + 400
  });

  it('связь на этап, которого нет в базовом расчёте, не выдумывает этап', () => {
    const snap = {
      requirements: [{ id: 'R9', code: 'ТР-09', description: 'Отчёты' }],
      manualLinks: [{ sourceId: 'R9', targetId: 'S-gone', method: 'MANUAL', approved: true }],
    };
    const impact = computeChangeImpact({
      ...base,
      basePackage: { ...base.basePackage, snapshot: snap },
      requirementIds: ['R9'],
    });
    expect(impact.stages.map((s) => s.id)).not.toContain('S-gone');
  });

  it('без комплекта и требований — пустое влияние, база записана', () => {
    const impact = computeChangeImpact({ ...base, basePackage: null, requirementIds: [] });
    expect(impact.stages).toEqual([]);
    expect(impact.documents).toEqual([]);
    expect(impact.checks).toEqual([]);
    expect(impact.base.packageId).toBeNull();
  });
});
