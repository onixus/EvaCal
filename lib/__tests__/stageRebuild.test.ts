import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  carryDependencies,
  expandWithApprovals,
  matchStageRows,
  primaryInputsFromStageRows,
  type IndexedDependency,
  type PrimaryStageInput,
} from '../scheduling';

const { op, tx, order } = vi.hoisted(() => {
  const op = (name: string) =>
    vi.fn(async (args: unknown) => ({ op: name, args, id: `new-${name}` }));
  const order: string[] = [];
  const tx = {
    $executeRaw: vi.fn(async () => {
      order.push('lock');
      return 0;
    }),
    stage: {
      findMany: vi.fn(),
      update: op('stage.update'),
      create: vi.fn(async () => ({ id: `created-${Math.random().toString(36).slice(2, 8)}` })),
      deleteMany: op('stage.deleteMany'),
    },
    stageDependency: {
      findMany: vi.fn(),
      deleteMany: op('dep.deleteMany'),
      createMany: op('dep.createMany'),
    },
  };
  return { op, tx, order };
});

vi.mock('@/lib/prisma', () => ({
  prisma: {
    stage: { findMany: vi.fn(), deleteMany: op('outer.stage.deleteMany') },
    stageDependency: { findMany: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  },
}));

import { prisma } from '@/lib/prisma';
import { rebuildStages } from '../calc';

const fs = (from: number, to: number, lagDays = 0): IndexedDependency => ({
  from,
  to,
  type: 'FS',
  lagDays,
});
const row = (id: string, name: string, role = 'architect', isApprovalTask = false) => ({
  id,
  name,
  role,
  isApprovalTask,
});

describe('перестройка этапов: сопоставление строк', () => {
  const old = [row('s1', 'A'), row('s2', 'B'), row('s3', 'C')];

  it('по sourceStageId, по названию с ролью, новые — null', () => {
    const primary: PrimaryStageInput[] = [
      { name: 'A', role: 'architect', hours: 6, sourceStageId: 's1' },
      { name: 'Новый', role: 'architect', hours: 6 },
      { name: 'C', role: 'architect', hours: 6 },
    ];
    expect(matchStageRows(primary, expandWithApprovals(primary), old)).toEqual(['s1', null, 's3']);
  });

  it('одноимённые этапы сопоставляются в относительном порядке и после вставки выше', () => {
    // Старые [X «Dev», Y «Dev»], новые [Новый, «Dev», «Dev»] → X, Y (а не Y, X).
    const dup = [row('X', 'Dev', 'developer'), row('Y', 'Dev', 'developer')];
    const primary: PrimaryStageInput[] = [
      { name: 'Новый', role: 'developer', hours: 1 },
      { name: 'Dev', role: 'developer', hours: 1 },
      { name: 'Dev', role: 'developer', hours: 1 },
    ];
    const items = expandWithApprovals(primary);
    // developer требует согласования: [0] Новый, [1] согл., [2] Dev, [3] согл., [4] Dev, [5] согл.
    const matched = matchStageRows(primary, items, dup);
    expect(matched.filter((_, i) => !items[i].isApprovalTask)).toEqual([null, 'X', 'Y']);
    // Без вставки — тоже по порядку.
    const two = primary.slice(1);
    const twoItems = expandWithApprovals(two);
    expect(
      matchStageRows(two, twoItems, dup).filter((_, i) => !twoItems[i].isApprovalTask),
    ).toEqual(['X', 'Y']);
  });

  it('строка согласования идёт за своим основным этапом', () => {
    const withApproval = [row('a', 'ТЗ', 'analyst'), row('ap', 'Согл', 'customer', true)];
    const primary: PrimaryStageInput[] = [
      { name: 'Новый', role: 'architect', hours: 1 },
      { name: 'ТЗ', role: 'analyst', hours: 6, sourceStageId: 'a' },
    ];
    // [0] Новый, [1] ТЗ, [2] согласование ТЗ
    expect(matchStageRows(primary, expandWithApprovals(primary), withApproval)).toEqual([
      null,
      'a',
      'ap',
    ]);
  });

  it('зависимости переносятся; «обратные» и с удалённым концом снимаются', () => {
    const deps = [{ fromStageId: 's1', toStageId: 's3', lagDays: 2 }];
    const keep: PrimaryStageInput[] = [
      { name: 'A', role: 'architect', hours: 6, sourceStageId: 's1' },
      { name: 'C', role: 'analyst', hours: 6, sourceStageId: 's3' },
    ];
    const items = expandWithApprovals(keep);
    expect(carryDependencies(items, matchStageRows(keep, items, old), deps)).toEqual([fs(0, 1, 2)]);
    const swapped = [...keep].reverse();
    const sItems = expandWithApprovals(swapped);
    expect(carryDependencies(sItems, matchStageRows(swapped, sItems, old), deps)).toEqual([]);
    const removed = [keep[0]];
    const rItems = expandWithApprovals(removed);
    expect(carryDependencies(rItems, matchStageRows(removed, rItems, old), deps)).toEqual([]);
  });
});

describe('длительность согласования сохраняется при повторном сохранении', () => {
  it('пишется и на основной этап, и на согласование', () => {
    const items = expandWithApprovals([{ name: 'ТЗ', role: 'analyst', hours: 6, approvalDays: 5 }]);
    expect(items.map((i) => i.approvalDays)).toEqual([5, 5]);
    // У роли без согласования длительность не хранится.
    expect(
      expandWithApprovals([{ name: 'X', role: 'architect', hours: 1, approvalDays: 5 }])[0]
        .approvalDays,
    ).toBeNull();
  });

  it('старые строки (длительность только на согласовании) читаются без потери', () => {
    const stored = [
      { ...row('a', 'ТЗ', 'analyst'), hours: 6, approvalDays: null },
      { ...row('ap', 'Согл', 'customer', true), hours: 0, approvalDays: 7 },
      { ...row('b', 'Схема'), hours: 3, approvalDays: null },
    ];
    const primary = primaryInputsFromStageRows(stored);
    expect(primary.map((p) => [p.sourceStageId, p.approvalDays])).toEqual([
      ['a', 7],
      ['b', null],
    ]);
    // Цикл «загрузить → сохранить → загрузить» сохраняет 7 дней.
    const again = expandWithApprovals(primary);
    expect(again[0].approvalDays).toBe(7);
    expect(again[1].approvalDays).toBe(7);
  });
});

describe('rebuildStages обновляет строки на месте', () => {
  beforeEach(() => vi.clearAllMocks());

  it('совпавшие этапы обновляются (факт и журнал не трогаются), удаляются только убранные', async () => {
    order.length = 0;
    vi.mocked(prisma.stage.findMany).mockResolvedValue([] as never);
    tx.stage.findMany.mockImplementation(async () => {
      order.push('read stages');
      return [row('s1', 'A'), row('s2', 'B'), row('s3', 'C')];
    });
    tx.stageDependency.findMany.mockImplementation(async () => {
      order.push('read deps');
      return [{ fromStageId: 's1', toStageId: 's3', lagDays: 1 }];
    });

    await rebuildStages(
      'c1',
      [
        { name: 'A', role: 'architect', hours: 8, sourceStageId: 's1' },
        { name: 'C', role: 'architect', hours: 6, sourceStageId: 's3' },
        { name: 'D', role: 'architect', hours: 2 },
      ],
      new Date('2026-03-02T00:00:00Z'),
    );

    // Блокировка расчёта — до чтения этапов и зависимостей, в той же транзакции.
    expect(order).toEqual(['lock', 'read stages', 'read deps']);
    expect(prisma.stageDependency.findMany).not.toHaveBeenCalled();
    // Ни одного «удалить всё»: снаружи транзакции этапы не удаляются.
    expect(prisma.stage.deleteMany).not.toHaveBeenCalled();
    expect(tx.stage.deleteMany).toHaveBeenCalledWith({
      where: { calculationId: 'c1', id: { in: ['s2'] } },
    });
    const updated = tx.stage.update.mock.calls.map(
      (c) => (c[0] as { where: { id: string } }).where.id,
    );
    expect(updated).toEqual(['s1', 's3']);
    // Обновляются только плановые поля — факт этапа (actual*) не перезаписывается.
    const data = (tx.stage.update.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(Object.keys(data).some((k) => k.startsWith('actual'))).toBe(false);
    expect(data.hours).toBe(8);
    expect(tx.stage.create).toHaveBeenCalledTimes(1);
    // Зависимость A → C перенесена на те же строки.
    const created = tx.stageDependency.createMany.mock.calls[0][0] as {
      data: { fromStageId: string; toStageId: string; lagDays: number }[];
    };
    expect(created.data).toEqual([
      { calculationId: 'c1', fromStageId: 's1', toStageId: 's3', type: 'FS', lagDays: 1 },
    ]);
  });
});
