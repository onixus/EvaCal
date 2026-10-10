import { describe, expect, it } from 'vitest';
import { parseActualsCsv } from '../actuals';
import {
  aggregateStageActuals,
  csvExternalId,
  csvToLedgerEntries,
  isStageTotalRow,
  isValidSource,
  manualHoursRule,
  planManualHours,
  planSync,
  type LedgerEntryInput,
  type StoredLedgerEntry,
} from '../actualsLedger';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

function stored(e: Partial<StoredLedgerEntry> & { externalId: string }): StoredLedgerEntry {
  return {
    id: `id-${e.externalId}`,
    source: 'csv',
    stageId: 's1',
    hours: 1,
    startDate: null,
    endDate: null,
    deletedAt: null,
    ...e,
  };
}

describe('aggregateStageActuals', () => {
  it('сумма неудалённых записей, null без часов', () => {
    expect(aggregateStageActuals([])).toEqual({
      actualHours: null,
      actualStartDate: null,
      actualEndDate: null,
    });
    const agg = aggregateStageActuals([
      stored({ externalId: 'a', hours: 4, startDate: d('2026-03-02') }),
      stored({ externalId: 'b', hours: 6.5, startDate: d('2026-03-01'), endDate: d('2026-03-05') }),
      stored({ externalId: 'c', hours: 100, deletedAt: new Date() }),
    ]);
    // Окончание из worklog не выводится: оно означало бы «этап завершён».
    expect(agg).toEqual({
      actualHours: 10.5,
      actualStartDate: d('2026-03-01'),
      actualEndDate: null,
    });
  });

  it('ручная поправка суммируется, итог не отрицательный, ручные даты приоритетны', () => {
    const agg = aggregateStageActuals([
      stored({ externalId: 'a', hours: 10, startDate: d('2026-03-01'), endDate: d('2026-03-09') }),
      stored({
        externalId: 'stage:s1',
        source: 'manual',
        hours: 2,
        startDate: d('2026-02-20'),
        endDate: d('2026-03-12'),
      }),
      stored({ externalId: 'adj:s1', source: 'manual', hours: -6, basis: 'csv' }),
    ]);
    expect(agg.actualHours).toBe(6);
    expect(agg.actualStartDate).toEqual(d('2026-02-20'));
    expect(agg.actualEndDate).toEqual(d('2026-03-12'));
    expect(
      aggregateStageActuals([
        stored({ externalId: 'm', source: 'manual', hours: -3 }),
        stored({ externalId: 'a', hours: 1 }),
      ]).actualHours,
    ).toBe(0);
  });

  it('запись только с датами не превращает факт часов в 0', () => {
    const agg = aggregateStageActuals([
      stored({ externalId: 'stage:s1', source: 'manual', hours: null, startDate: d('2026-01-01') }),
    ]);
    expect(agg.actualHours).toBeNull();
    expect(agg.actualStartDate).toEqual(d('2026-01-01'));
  });
});

describe('planManualHours', () => {
  const csv = (hours: number | null) => ({ source: 'csv', hours });
  it('без источников — обычный ручной ввод в базовую запись', () => {
    expect(planManualHours(12, 120, [])).toEqual({ baseHours: 12, adjustment: null });
    expect(planManualHours(12, null, [{ source: 'manual', hours: 3 }])).toEqual({
      baseHours: 12,
      adjustment: null,
    });
  });
  it('поверх источников — поправка до введённого итога, база не меняется', () => {
    expect(planManualHours(130, 120, [csv(8)])).toEqual({
      adjustment: { hours: 2, basis: ['csv'] },
    });
    expect(planManualHours(7.5, null, [csv(10), { source: 'jira', hours: 0 }])).toEqual({
      adjustment: { hours: -2.5, basis: ['csv', 'jira'] },
    });
    expect(planManualHours(128, 120, [csv(8)])).toEqual({ adjustment: null });
  });
  it('null убирает ручные часы, не трогая источники', () => {
    expect(planManualHours(null, 120, [csv(8)])).toEqual({ baseHours: null, adjustment: null });
  });
});

describe('planSync', () => {
  const incoming = (externalId: string, hours: number, extra: Partial<LedgerEntryInput> = {}) => ({
    externalId,
    stageId: 's1',
    hours,
    ...extra,
  });

  it('повтор той же выгрузки — без изменений, факт не удваивается', () => {
    const existing = [stored({ externalId: 'a', hours: 4 }), stored({ externalId: 'b', hours: 2 })];
    const plan = planSync(existing, [incoming('a', 4), incoming('b', 2)], { mode: 'full' });
    expect(plan.create).toEqual([]);
    expect(plan.update).toEqual([]);
    expect(plan.remove).toEqual([]);
    expect(plan.unchanged).toEqual(['id-a', 'id-b']);
  });

  it('исправление заменяет значение, а не добавляет запись', () => {
    const plan = planSync([stored({ externalId: 'a', hours: 4 })], [incoming('a', 5)]);
    expect(plan.create).toEqual([]);
    expect(plan.update).toEqual([{ id: 'id-a', entry: incoming('a', 5), revived: false }]);
  });

  it('пропавшие записи удаляются только при полной синхронизации', () => {
    const existing = [stored({ externalId: 'a' }), stored({ externalId: 'gone' })];
    expect(planSync(existing, [incoming('a', 1)], { mode: 'incremental' }).remove).toEqual([]);
    expect(planSync(existing, [incoming('a', 1)], { mode: 'full' }).remove).toEqual(['id-gone']);
    expect(
      planSync(existing, [incoming('a', 1)], { mode: 'full', keepExternalIds: ['gone'] }).remove,
    ).toEqual([]);
  });

  it('вернувшаяся запись восстанавливается, устаревшая версия пропускается', () => {
    const existing = [
      stored({ externalId: 'a', hours: 1, deletedAt: new Date() }),
      stored({ externalId: 'b', hours: 3, externalUpdatedAt: d('2026-03-10') }),
    ];
    const plan = planSync(existing, [
      incoming('a', 1),
      incoming('b', 9, { externalUpdatedAt: d('2026-03-01') }),
    ]);
    expect(plan.update).toEqual([{ id: 'id-a', entry: incoming('a', 1), revived: true }]);
    expect(plan.skipped).toEqual(['b']);
  });

  it('дубль externalId во входе: побеждает последняя строка', () => {
    const plan = planSync([], [incoming('a', 1), incoming('a', 2)]);
    expect(plan.create).toEqual([incoming('a', 2)]);
    expect(plan.skipped).toEqual(['a']);
  });
});

describe('CSV → журнал', () => {
  const stages = [
    { id: 's1', name: 'Обследование', isApprovalTask: false },
    { id: 's2', name: 'Проектирование', isApprovalTask: false },
    { id: 's3', name: 'Согласование', isApprovalTask: true },
  ];

  it('старый формат: ключ — этап, повторный импорт с другими часами исправляет запись', () => {
    const first = csvToLedgerEntries(parseActualsCsv('Обследование;12').rows, stages);
    const second = csvToLedgerEntries(
      parseActualsCsv('обследование ;14;2026-03-01;2026-03-20').rows,
      stages,
    );
    expect(first.entries[0].externalId).toBe(second.entries[0].externalId);
    expect(second.entries[0]).toMatchObject({
      stageId: 's1',
      hours: 14,
      startDate: d('2026-03-01'),
      endDate: d('2026-03-20'),
    });
  });

  it('заголовок с id: externalId — явный id; без id — хэш (задача, дата, автор)', () => {
    const { rows, invalid } = parseActualsCsv(
      [
        'ID;Задача;Этап;Часы;Дата;Автор',
        'W-1;;Обследование;3;2026-03-02;ivanov',
        ';PRJ-7;;2;2026-03-03;petrov',
        ';PRJ-7;;1,5;2026-03-03;Petrov ',
        ';PRJ-8;;1;2026-03-04;petrov',
      ].join('\n'),
    );
    expect(invalid).toEqual([]);
    expect(rows[0]).toMatchObject({ id: 'W-1', stage: 'Обследование', hours: 3 });
    expect(csvExternalId(rows[0])).toBe('id:W-1');
    expect(csvExternalId(rows[1])).toBe(csvExternalId(rows[2]));
    expect(csvExternalId(rows[1])).toMatch(/^h:[0-9a-f]{32}$/);
    expect(csvExternalId(rows[1])).not.toBe(csvExternalId(rows[3]));
    // Дата нормализуется до хэша: разные записи одной даты дают один ключ.
    expect(csvExternalId({ ...rows[1], date: '03.03.2026' })).toBe(csvExternalId(rows[1]));
    expect(csvExternalId({ ...rows[0], id: 'x'.repeat(300) })).toMatch(/^idh:[0-9a-f]{32}$/);

    const res = csvToLedgerEntries(rows, stages, { 'PRJ-7': 's2' });
    expect(res.unmappedTasks).toEqual(['PRJ-8']);
    // Строки с одинаковым ключом — одна запись источника, часы суммируются.
    expect(res.entries.map((e) => [e.stageId, e.hours])).toEqual([
      ['s1', 3],
      ['s2', 3.5],
    ]);
    expect(res.allExternalIds).toHaveLength(3);
  });

  it('повтор явного id в файле — берётся последняя строка и сообщается', () => {
    const res = csvToLedgerEntries(
      parseActualsCsv('id;этап;часы\nW-1;Обследование;3\nW-1;Обследование;5').rows,
      stages,
    );
    expect(res.entries).toHaveLength(1);
    expect(res.entries[0].hours).toBe(5);
    expect(res.duplicateIds).toEqual(['W-1']);
  });

  it('этапы согласования и неоднозначные имена не принимают факт', () => {
    const res = csvToLedgerEntries(parseActualsCsv('Согласование;1\nНет такого;2').rows, stages);
    expect(res.entries).toEqual([]);
    expect(res.unmatched).toEqual(['Согласование', 'Нет такого']);
  });
});

describe('isValidSource', () => {
  it('совпадает с CHECK миграции', () => {
    expect(isValidSource('csv')).toBe(true);
    expect(isValidSource('my-tracker_2')).toBe(true);
    expect(isValidSource('CSV')).toBe(false);
    expect(isValidSource('')).toBe(false);
  });
});

describe('строки-итоги и правило ручных часов', () => {
  it('итог — без id, даты и автора; worklog — с любым из них', () => {
    const [total, worklog] = parseActualsCsv(
      'этап;часы;дата\nАнализ;40;\nАнализ;8;2026-03-02',
    ).rows;
    expect(isStageTotalRow(total)).toBe(true);
    expect(isStageTotalRow(worklog)).toBe(false);
    expect(isStageTotalRow(parseActualsCsv('Анализ;40;2026-03-01;2026-03-09').rows[0])).toBe(true);
  });
  it('auto: итог заменяет ручные часы, worklog добавляется; явный режим главнее', () => {
    expect(manualHoursRule('auto', true)).toBe('replace');
    expect(manualHoursRule('auto', false)).toBe('add');
    expect(manualHoursRule('add', true)).toBe('add');
    expect(manualHoursRule('replace', false)).toBe('replace');
  });
});
