/**
 * Маршрут CSV-импорта факта поверх журнала с хранилищем в памяти: проверяет
 * идемпотентность, исправления, политику полной выгрузки и сопоставление
 * задач без PostgreSQL (то же на живой БД — scripts/verify-actuals-sync.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown> & { id: string };

const db = vi.hoisted(() => {
  const tables: Record<string, Row[]> = {};
  let seq = 0;
  const matches = (row: Row, where: Record<string, unknown> = {}) =>
    Object.entries(where).every(([k, v]) =>
      v && typeof v === 'object' && 'in' in (v as object)
        ? ((v as { in: unknown[] }).in ?? []).includes(row[k])
        : v && typeof v === 'object' && 'not' in (v as object)
          ? (row[k] ?? null) !== (v as { not: unknown }).not
          : (row[k] ?? null) === v,
    );
  const model = (name: string) => {
    const t = () => (tables[name] ??= []);
    return {
      findMany: async ({ where }: { where?: Record<string, unknown> } = {}) =>
        t()
          .filter((r) => matches(r, where))
          .map((r) => ({ ...r })),
      findUniqueOrThrow: async ({ where }: { where: Record<string, unknown> }) => ({
        ...t().find((r) => matches(r, where))!,
      }),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `${name}-${++seq}`, deletedAt: null, createdAt: new Date(), ...data };
        t().push(row);
        return { ...row };
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = t().find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return { ...row };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const rows = t().filter((r) => matches(r, where));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: Record<string, Record<string, unknown>>;
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const key = Object.values(where)[0];
        const row = t().find((r) => matches(r, key));
        if (row) return Object.assign(row, update);
        const created = { id: `${name}-${++seq}`, ...create };
        t().push(created);
        return created;
      },
    };
  };
  const prisma = {
    stage: model('stage'),
    actualEntry: model('actualEntry'),
    actualSyncRun: model('actualSyncRun'),
    externalTaskMapping: model('externalTaskMapping'),
    $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
    $executeRaw: async () => 0,
  };
  return { tables, prisma };
});

vi.mock('@/lib/prisma', () => ({ prisma: db.prisma }));
vi.mock('@/lib/auth', () => ({
  requireApiRole: vi.fn(async () => ({ userId: 'u1', username: 'a', role: 'architect', exp: 0 })),
}));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(), clientIp: vi.fn() }));
vi.mock('@/lib/actualsData', () => ({ actualsWriteGate: vi.fn(async () => ({ ok: true })) }));

import { POST } from '@/app/api/calculations/[id]/actuals/import/route';
import { recordManualStageEdit } from '../actualsLedgerData';
import { prisma } from '@/lib/prisma';

const props = { params: Promise.resolve({ id: 'c1' }) };
const post = async (body: Record<string, unknown>) => {
  const res = await POST(
    new NextRequest('http://localhost/x', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }),
    props,
  );
  return { status: res.status, data: await res.json() };
};
const hoursOf = (id: string) => db.tables.stage.find((s) => s.id === id)?.actualHours;

const worklogCsv = (rows: string[]) => ['id;задача;этап;часы;дата', ...rows].join('\n');

describe('POST /api/calculations/:id/actuals/import через журнал', () => {
  beforeEach(() => {
    for (const k of Object.keys(db.tables)) delete db.tables[k];
    db.tables.stage = [
      { id: 's1', calculationId: 'c1', name: 'Обследование', isApprovalTask: false },
      { id: 's2', calculationId: 'c1', name: 'Проектирование', isApprovalTask: false },
    ];
  });

  it('dry-run ничего не пишет и показывает план', async () => {
    const { status, data } = await post({ csv: 'Обследование;12', dryRun: true });
    expect(status).toBe(200);
    expect(data.counts).toMatchObject({ created: 1, updated: 0, unchanged: 0 });
    expect(data.applied).toBe(false);
    expect(db.tables.actualEntry ?? []).toHaveLength(0);
    expect(hoursOf('s1')).toBeUndefined();
  });

  it('повторный импорт не удваивает факт, исправление заменяет значение', async () => {
    const csv = worklogCsv(['W1;;Обследование;4;2026-03-02', 'W2;;Обследование;6;2026-03-03']);
    await post({ csv });
    expect(hoursOf('s1')).toBe(10);
    const again = await post({ csv });
    expect(again.data.counts).toMatchObject({ created: 0, updated: 0, unchanged: 2 });
    expect(hoursOf('s1')).toBe(10);

    const fixed = await post({
      csv: worklogCsv(['W1;;Обследование;5;2026-03-02', 'W2;;Обследование;6;2026-03-03']),
    });
    expect(fixed.data.counts).toMatchObject({ updated: 1, unchanged: 1 });
    expect(hoursOf('s1')).toBe(11);
    expect(db.tables.actualEntry).toHaveLength(2);
  });

  it('пропавшая строка удаляется только при полной выгрузке', async () => {
    await post({ csv: worklogCsv(['W1;;Обследование;4;', 'W2;;Обследование;6;']) });
    await post({ csv: worklogCsv(['W1;;Обследование;4;']) });
    expect(hoursOf('s1')).toBe(10);
    const full = await post({ csv: worklogCsv(['W1;;Обследование;4;']), mode: 'full' });
    expect(full.data.counts).toMatchObject({ deleted: 1 });
    expect(hoursOf('s1')).toBe(4);
    expect(db.tables.actualEntry.find((e) => e.externalId === 'id:W2')?.deletedAt).toBeInstanceOf(
      Date,
    );
  });

  it('задачу сопоставляют в превью, сопоставление запоминается', async () => {
    const csv = worklogCsv(['W1;PRJ-1;;3;2026-03-02']);
    const preview = await post({ csv, dryRun: true });
    expect(preview.data.unmappedTasks).toEqual(['PRJ-1']);
    await post({ csv, mappings: { 'PRJ-1': 's2' } });
    expect(hoursOf('s2')).toBe(3);
    const again = await post({ csv: worklogCsv(['W1;PRJ-1;;3.5;2026-03-02']) });
    expect(again.data.unmappedTasks).toEqual([]);
    expect(hoursOf('s2')).toBe(3.5);
  });

  it('сопоставление на чужой этап — 400', async () => {
    const res = await post({ csv: 'x', mappings: { 'PRJ-1': 'alien' } });
    expect(res.status).toBe(400);
  });

  it('перенесённые 120 ч + 8 ч дельтой CSV = 128 ч, ручные даты сохраняются', async () => {
    // Так миграция переносит факт, внесённый до журнала.
    db.tables.actualEntry = [
      {
        id: 'ae_legacy',
        calculationId: 'c1',
        stageId: 's1',
        source: 'manual',
        externalId: 'stage:s1',
        hours: 120,
        startDate: new Date('2026-02-01T00:00:00Z'),
        endDate: new Date('2026-02-28T00:00:00Z'),
        deletedAt: null,
      },
    ];
    await post({ csv: worklogCsv(['W1;;Обследование;8;2026-03-02']) });
    const s1 = db.tables.stage.find((s) => s.id === 's1')!;
    expect(s1.actualHours).toBe(128);
    expect(s1.actualStartDate).toEqual(new Date('2026-02-01T00:00:00Z'));
    expect(s1.actualEndDate).toEqual(new Date('2026-02-28T00:00:00Z'));
    // Полная выгрузка тоже не трогает базовую ручную запись.
    await post({ csv: worklogCsv(['W1;;Обследование;9;2026-03-02']), mode: 'full' });
    expect(hoursOf('s1')).toBe(129);
    expect(db.tables.actualEntry.find((e) => e.id === 'ae_legacy')?.deletedAt).toBeNull();
  });

  it('worklog задаёт начало, но не окончание этапа', async () => {
    await post({
      csv: worklogCsv(['W1;;Проектирование;2;2026-03-05', 'W2;;Проектирование;2;2026-03-02']),
    });
    const s2 = db.tables.stage.find((s) => s.id === 's2')!;
    expect(s2.actualStartDate).toEqual(new Date('2026-03-02T00:00:00Z'));
    expect(s2.actualEndDate).toBeNull();
  });

  it('поправка поверх worklog: дельта её сохраняет, полная выгрузка с изменением снимает', async () => {
    const w = (h: number) => worklogCsv([`W1;;Обследование;${h};2026-03-02`]);
    await post({ csv: w(10) });
    await recordManualStageEdit(prisma as never, { calculationId: 'c1', stageId: 's1', hours: 12 });
    expect(hoursOf('s1')).toBe(12);
    await post({ csv: w(10), mode: 'full' });
    expect(hoursOf('s1')).toBe(12);
    await post({ csv: w(11) });
    expect(hoursOf('s1')).toBe(13);
    const changed = await post({ csv: w(14), mode: 'full', dryRun: true });
    expect(changed.data.manualResetStages).toEqual(['Обследование']);
    await post({ csv: w(14), mode: 'full' });
    expect(hoursOf('s1')).toBe(14);
  });

  const migratedBase = (hours: number) => {
    db.tables.actualEntry = [
      {
        id: 'ae_legacy',
        calculationId: 'c1',
        stageId: 's1',
        source: 'manual',
        externalId: 'stage:s1',
        hours,
        startDate: new Date('2026-02-01T00:00:00Z'),
        endDate: null,
        deletedAt: null,
      },
    ];
    db.tables.stage[0].actualHours = hours;
  };

  it('итог этапа после миграции: тот же итог не удваивается, накопительный заменяет', async () => {
    migratedBase(40);
    const preview = await post({ csv: 'Обследование;40', dryRun: true });
    expect(preview.data.manualStages).toEqual([
      expect.objectContaining({ name: 'Обследование', manualHours: 40, rule: 'replace' }),
    ]);
    await post({ csv: 'Обследование;40' });
    expect(hoursOf('s1')).toBe(40);
    await post({ csv: 'Обследование;45' });
    expect(hoursOf('s1')).toBe(45);
    // Ручная дата начала осталась, часы базы обнулены, а не удалены вместе с датой.
    const base = db.tables.actualEntry.find((e) => e.id === 'ae_legacy')!;
    expect(base).toMatchObject({ hours: null, deletedAt: null });
    expect(db.tables.stage[0].actualStartDate).toEqual(new Date('2026-02-01T00:00:00Z'));
    expect(db.tables.actualSyncRun.at(-1)).toMatchObject({ manualHours: 'auto' });
  });

  it('итог этапа с режимом «добавить к ручным» складывается', async () => {
    migratedBase(40);
    await post({ csv: 'Обследование;5', manualHours: 'add' });
    expect(hoursOf('s1')).toBe(45);
    expect(db.tables.actualSyncRun.at(-1)).toMatchObject({ manualHours: 'add' });
  });

  it('migrated 120 + worklog 8 с датой = 128 (правило add в превью)', async () => {
    migratedBase(120);
    const csv = worklogCsv(['W1;;Обследование;8;2026-03-02']);
    const preview = await post({ csv, dryRun: true });
    expect(preview.data.manualStages[0].rule).toBe('add');
    await post({ csv });
    expect(hoursOf('s1')).toBe(128);
  });

  it('введено 40 вручную, затем worklog с «заменить ручные часы» = сумма worklog', async () => {
    await recordManualStageEdit(prisma as never, { calculationId: 'c1', stageId: 's1', hours: 40 });
    expect(hoursOf('s1')).toBe(40);
    await post({
      csv: worklogCsv(['W1;;Обследование;30;2026-03-02', 'W2;;Обследование;12;2026-03-03']),
      manualHours: 'replace',
    });
    expect(hoursOf('s1')).toBe(42);
  });

  it('неизвестный режим ручных часов — 400', async () => {
    expect((await post({ csv: 'x', manualHours: 'merge' })).status).toBe(400);
  });

  it('очистка ручных часов не удаляет записи источников', async () => {
    await post({ csv: 'Обследование;10' });
    await recordManualStageEdit(prisma as never, { calculationId: 'c1', stageId: 's1', hours: 12 });
    await recordManualStageEdit(prisma as never, {
      calculationId: 'c1',
      stageId: 's1',
      hours: null,
    });
    expect(hoursOf('s1')).toBe(10);
    expect(db.tables.actualEntry.filter((e) => e.source === 'csv' && !e.deletedAt)).toHaveLength(1);
  });

  it('сопоставление задачи переносит уже записанные записи этой задачи', async () => {
    db.tables.actualEntry = [
      {
        id: 'w1',
        calculationId: 'c1',
        stageId: null,
        source: 'csv',
        externalId: 'id:T1',
        externalTaskKey: 'PRJ-9',
        hours: 5,
        deletedAt: null,
      },
    ];
    await post({ csv: worklogCsv(['T2;PRJ-9;;1;2026-03-02']), mappings: { 'PRJ-9': 's2' } });
    expect(db.tables.actualEntry.find((e) => e.id === 'w1')?.stageId).toBe('s2');
    expect(hoursOf('s2')).toBe(6);
  });
});
