import { describe, it, expect } from 'vitest';
import {
  buildDeviationReport,
  normalizeConfig,
  taskCatalog,
  taskKey,
  type DeviationRow,
} from '../deviations';

const row = (over: Partial<DeviationRow>): DeviationRow => ({
  calculationId: 'c1',
  calculationName: 'Calc',
  customer: 'Банк',
  templateName: 'T',
  architect: 'ann',
  closedAt: new Date('2026-03-01T00:00:00Z'),
  stageId: 's',
  task: 'Установка агентов',
  role: 'engineer',
  plannedHours: 10,
  actualHours: 12,
  plannedDays: 5,
  actualDays: 5,
  ...over,
});

describe('отклонения по задачам', () => {
  it('ключ задачи снимает регистр, пробелы и номер', () => {
    expect(taskKey('  1. Установка   агентов ')).toBe('установка агентов');
    expect(taskKey('УСТАНОВКА АГЕНТОВ')).toBe('установка агентов');
    expect(taskKey('2) Настройка')).toBe('настройка');
  });

  it('каталог задач: самое частое написание, число наблюдений, медиана', () => {
    const rows = [
      row({ task: 'Установка агентов', actualHours: 15 }),
      row({ task: 'установка агентов', actualHours: 12, stageId: 's2', calculationId: 'c2' }),
      row({ task: 'Установка агентов', actualHours: 9, stageId: 's3', calculationId: 'c3' }),
      row({ task: 'Обследование', plannedHours: 0, actualHours: 5 }),
    ];
    const cat = taskCatalog(rows);
    expect(cat[0]).toMatchObject({
      key: 'установка агентов',
      label: 'Установка агентов',
      samples: 3,
      medianDeviation: 0.2,
    });
    expect(cat[1]).toMatchObject({ key: 'обследование', samples: 0, medianDeviation: null });
  });

  it('срез: фильтр по задачам, группировка и допуск', () => {
    const rows = [
      row({ actualHours: 15 }), // +0.5 перерасход
      row({ actualHours: 10.5, calculationId: 'c2', architect: 'bob' }), // +0.05 в допуске
      row({ actualHours: 7, calculationId: 'c3', architect: 'bob' }), // −0.3 недорасход
      row({ task: 'Обследование', actualHours: 30, calculationId: 'c4' }), // не выбрана
    ];
    const r = buildDeviationReport(rows, {
      tasks: ['Установка агентов'],
      groupBy: 'architect',
      metric: 'median',
    });
    expect(r.rowsUsed).toBe(3);
    expect(r.overall).toMatchObject({
      samples: 3,
      median: 0.05,
      over: 1,
      under: 1,
      within: 1,
      lowSample: false,
    });
    const bob = r.groups.find((g) => g.key === 'bob')!;
    expect(bob).toMatchObject({
      samples: 2,
      median: -0.12,
      lowSample: true,
      plannedTotal: 20,
      actualTotal: 17.5,
    });
    expect(r.groups[0].key).toBe('ann'); // |0.5| больше |−0.13|
  });

  it('метрики mean и p90, сравнение по дням, период и месяц', () => {
    const rows = [
      row({ actualHours: 12, actualDays: 10, closedAt: new Date('2026-01-15T00:00:00Z') }),
      row({
        actualHours: 20,
        actualDays: 5,
        calculationId: 'c2',
        closedAt: new Date('2026-02-15T00:00:00Z'),
      }),
      row({ actualHours: 10, actualDays: null, calculationId: 'c3', closedAt: null }),
    ];
    const mean = buildDeviationReport(rows, { tasks: [], groupBy: 'task', metric: 'mean' });
    expect(mean.overall.mean).toBe(0.4); // (0.2 + 1 + 0)/3
    const p90 = buildDeviationReport(rows, { tasks: [], groupBy: 'task', metric: 'p90' });
    expect(p90.overall.value).toBe(1);
    const days = buildDeviationReport(rows, {
      tasks: [],
      groupBy: 'month',
      metric: 'median',
      kind: 'days',
    });
    expect(days.rowsUsed).toBe(2);
    expect(days.groups.map((g) => [g.key, g.value])).toEqual([
      ['2026-01', 1],
      ['2026-02', 0],
    ]);
    const period = buildDeviationReport(rows, {
      tasks: [],
      groupBy: 'task',
      metric: 'median',
      from: '2026-02-01',
      to: '2026-02-28',
    });
    expect(period.rowsUsed).toBe(1);
    // «по» включает весь последний день: сделка, закрытая 15.02 в 10:00, входит в «по 15.02».
    const lastDay = buildDeviationReport([row({ closedAt: new Date('2026-02-15T10:00:00Z') })], {
      tasks: [],
      groupBy: 'task',
      metric: 'median',
      from: '2026-02-01',
      to: '2026-02-15',
    });
    expect(lastDay.rowsUsed).toBe(1);
  });

  it('normalizeConfig отбрасывает мусор и ставит значения по умолчанию', () => {
    const c = normalizeConfig({
      tasks: ['a', ' ', 1],
      groupBy: 'nope',
      metric: 'p90',
      from: 'garbage',
      tolerance: 5,
      minSamples: 0,
      kind: 'days',
    });
    expect(c).toMatchObject({
      tasks: ['a', '1'],
      groupBy: 'task',
      metric: 'p90',
      from: null,
      tolerance: 0.1,
      minSamples: 3,
      kind: 'days',
    });
    expect(normalizeConfig(null).groupBy).toBe('task');
  });
});
