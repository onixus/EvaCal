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
      originalText: 'Вход по паролю (исходник)',
      criterion: 'Вход проходит; неверный пароль отклоняется',
    },
    { id: 'R2', code: 'ТР-02', description: 'Журнал событий', mappedStageId: 'S2' },
    { id: 'R3', code: 'ТР-03', description: 'Отчёты' },
    { id: 'R4', code: 'ТР-04', normalizedText: 'Резервное копирование', originalText: 'бэкап' },
  ],
  manualLinks: [
    { sourceId: 'R1', targetId: 'S1', method: 'MANUAL', approved: true },
    { sourceId: 'R1', targetStageId: 'S2' }, // старый формат снимка
    { sourceId: 'R3', targetId: '', method: 'MANUAL', approved: true }, // «не распределено»
    { sourceId: 'R4', targetId: 'S-gone', method: 'MANUAL', approved: true },
  ],
};

const stages = [
  { id: 'S1', name: 'Проектирование', role: 'architect', hours: 120 },
  { id: 'S2', name: 'Разработка', role: 'engineer', hours: 400 },
  { id: 'S3', name: 'Внедрение', role: 'engineer', hours: 80 },
];

const base = {
  calculation: { id: 'c1', version: 2, currency: 'RUB' },
  stages,
  basePackage: { id: 'p1', version: 3, documentTypes: ['TZ', 'pmi', 'tz'], snapshot },
  now: new Date('2026-10-10T00:00:00Z'),
};

describe('requirementsFromSnapshot', () => {
  it('берёт видимый заказчику текст: нормализованный, иначе описание', () => {
    expect(requirementsFromSnapshot(snapshot)).toEqual([
      { id: 'R1', code: 'ТР-01', text: 'Вход по паролю' },
      { id: 'R2', code: 'ТР-02', text: 'Журнал событий' },
      { id: 'R3', code: 'ТР-03', text: 'Отчёты' },
      { id: 'R4', code: 'ТР-04', text: 'Резервное копирование' },
    ]);
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

describe('traceLinksFromSnapshot', () => {
  it('понимает TraceLink, старый targetStageId и legacy mappedStageId; пропускает «не распределено»', () => {
    expect(traceLinksFromSnapshot(snapshot)).toEqual([
      { requirementId: 'R1', stageId: 'S1' },
      { requirementId: 'R1', stageId: 'S2' },
      { requirementId: 'R4', stageId: 'S-gone' },
      { requirementId: 'R2', stageId: 'S2' },
    ]);
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
      },
      {
        id: 'S2',
        name: 'Разработка',
        role: 'engineer',
        baseHours: 400,
        requirementIds: ['R1', 'R2'],
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

  it('этап из снимка, которого нет в базовом расчёте, помечается, а не выдумывается', () => {
    const impact = computeChangeImpact({ ...base, requirementIds: ['R4'] });
    expect(impact.stages).toEqual([
      { id: 'S-gone', name: '', role: '', baseHours: null, requirementIds: ['R4'], missing: true },
    ]);
  });

  it('без комплекта и требований — пустое влияние, база записана', () => {
    const impact = computeChangeImpact({ ...base, basePackage: null, requirementIds: [] });
    expect(impact.stages).toEqual([]);
    expect(impact.documents).toEqual([]);
    expect(impact.checks).toEqual([]);
    expect(impact.base.packageId).toBeNull();
  });
});
