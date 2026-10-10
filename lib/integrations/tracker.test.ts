import { describe, expect, it, vi } from 'vitest';
import { runTrackerSync, worklogsToEntries, type TrackerConnector } from './tracker';

const worklog = (id: string, taskKey: string, hours: number) => ({
  id,
  taskKey,
  hours,
  startedAt: new Date('2026-03-02T09:00:00Z'),
});

describe('worklogsToEntries', () => {
  it('сопоставляет задачи с этапами и не теряет несопоставленные', () => {
    const res = worklogsToEntries(
      [worklog('1', 'PRJ-1', 2), worklog('2', 'PRJ-2', 1), worklog('', 'PRJ-1', 1)],
      { 'PRJ-1': 's1' },
    );
    expect(res.entries.map((e) => [e.externalId, e.stageId])).toEqual([
      ['1', 's1'],
      ['2', null],
    ]);
    expect(res.unmappedTasks).toEqual(['PRJ-2']);
    expect(res.errors).toHaveLength(1);
  });
});

it('слишком длинный id отклоняет только эту запись', () => {
  const res = worklogsToEntries([worklog('x'.repeat(201), 'PRJ-1', 1), worklog('ok', 'PRJ-1', 1)], {
    'PRJ-1': 's1',
  });
  expect(res.entries.map((e) => e.externalId)).toEqual(['ok']);
  expect(res.errors).toHaveLength(1);
});

describe('runTrackerSync', () => {
  const deps = () => ({
    sync: vi.fn(async () => ({
      counts: { created: 1, updated: 0, unchanged: 0, deleted: 0, skipped: 0 },
      plan: { create: [], update: [], unchanged: [], remove: [], skipped: [] },
      manualResetStageIds: [],
      runId: 'r1',
    })),
    loadMappings: vi.fn(async () => ({ 'PRJ-1': 's1' })),
  });
  const connector = (complete: boolean): TrackerConnector => ({
    source: 'tracker',
    label: 'Тестовый трекер',
    fetchWorklogs: vi.fn(async () => ({
      worklogs: [worklog('1', 'PRJ-1', 2)],
      nextCursor: 'c2',
      complete,
    })),
  });

  it('дельта с курсора — incremental, полный набор — full', async () => {
    const d = deps();
    await runTrackerSync(
      connector(false),
      { calculationId: 'c1', scope: 'PRJ', cursor: 'c1', startedBy: 'u1' },
      d,
    );
    expect(d.sync).toHaveBeenLastCalledWith(
      expect.objectContaining({ source: 'tracker', mode: 'incremental', cursor: 'c2' }),
    );
    await runTrackerSync(
      connector(true),
      { calculationId: 'c1', scope: 'PRJ', cursor: null, startedBy: 'u1' },
      d,
    );
    expect(d.sync).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'full' }));
  });

  it('не позволяет коннектору писать от имени csv/manual', async () => {
    const bad = { ...connector(true), source: 'manual' };
    await expect(
      runTrackerSync(
        bad,
        { calculationId: 'c1', scope: 'x', cursor: null, startedBy: null },
        deps(),
      ),
    ).rejects.toThrow(/source/);
  });
});
