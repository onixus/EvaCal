import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/auth', () => ({ requireApiRole: vi.fn() }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(), clientIp: vi.fn(() => '127.0.0.1') }));

// Каждая запись Prisma — шпион, который пишет операцию в общий журнал `log`.
const { op, log } = vi.hoisted(() => {
  const log: { op: string; args: { where: { id: string }; data: Record<string, Date> } }[] = [];
  const op = (name: string) =>
    vi.fn((args: unknown) => {
      const entry = { op: name, args: args as (typeof log)[number]['args'] };
      log.push(entry);
      return entry;
    });
  return { op, log };
});
vi.mock('@/lib/prisma', () => {
  const p: Record<string, unknown> = {
    calculation: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: op('calculation.update'),
      create: op('calculation.create'),
      delete: op('calculation.delete'),
    },
    stage: {
      update: op('stage.update'),
      create: op('stage.create'),
      delete: op('stage.delete'),
      deleteMany: op('stage.deleteMany'),
      updateMany: op('stage.updateMany'),
    },
    stageDependency: {
      findMany: vi.fn(async () => []),
      create: op('stageDependency.create'),
      createMany: op('stageDependency.createMany'),
      deleteMany: op('stageDependency.deleteMany'),
    },
    roleCapacity: { findMany: vi.fn() },
    roleReservation: { findMany: vi.fn() },
    workCalendar: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
    planScenario: { create: op('planScenario.create'), findMany: vi.fn() },
    $executeRaw: vi.fn(() => log.push({ op: 'lock', args: {} as never })),
    $executeRawUnsafe: vi.fn(),
  };
  // Интерактивная транзакция получает тот же клиент: записи видны в `log`.
  p.$transaction = vi.fn(async (arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(p) : arg,
  );
  return { prisma: p };
});

import { requireApiRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { POST as whatIf } from '@/app/api/capacity/what-if/route';
import { POST as apply } from '@/app/api/capacity/apply/route';
import { PUT as putDependencies } from '@/app/api/calculations/[id]/dependencies/route';
import { GET as earliestStart } from '@/app/api/calculations/[id]/earliest-start/route';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const session = (role: string) => ({ userId: 'u1', username: 'x', role, exp: 0 });
const json = (url: string, body: unknown, method = 'POST') =>
  new NextRequest(url, {
    method,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });

// Расчёт: A (архитектор, 12 ч) → B (архитектор, 6 ч), старт пн 2.03.2026.
const stages = [
  {
    id: 'sA',
    name: 'A',
    role: 'architect',
    hours: 12,
    isApprovalTask: false,
    requirements: null,
    parallel: false,
    approvalDays: null,
    startDate: new Date('2026-03-02T09:00:00Z'),
    endDate: new Date('2026-03-03T15:00:00Z'),
  },
  {
    id: 'sB',
    name: 'B',
    role: 'architect',
    hours: 6,
    isApprovalTask: false,
    requirements: null,
    parallel: false,
    approvalDays: null,
    startDate: new Date('2026-03-03T15:00:00Z'),
    endDate: new Date('2026-03-04T15:00:00Z'),
  },
];
const calcRow = {
  id: 'c1',
  name: 'Проект',
  version: 1,
  status: 'approved',
  projectId: null,
  startDate: d('2026-03-02'),
  roleRates: null,
  template: { workDayHours: 6, includeWeekends: false, calendarId: 'cal' },
  project: null,
  stages,
  stageDependencies: [] as {
    fromStageId: string;
    toStageId: string;
    type: string;
    lagDays: number;
  }[],
};
// Праздник в пн 16.03 — в окне после переноса на 14 дней.
const calendarRow = {
  id: 'cal',
  isDefault: true,
  weekendDays: '6,7',
  exceptions: [{ date: d('2026-03-16'), kind: 'holiday', hours: null }],
};

const writeSpies = () => [
  prisma.calculation.update,
  prisma.calculation.create,
  prisma.calculation.delete,
  prisma.stage.update,
  prisma.stage.create,
  prisma.stage.delete,
  prisma.stage.deleteMany,
  prisma.stage.updateMany,
  prisma.stageDependency.create,
  prisma.stageDependency.createMany,
  prisma.stageDependency.deleteMany,
  prisma.planScenario.create,
  prisma.$transaction,
  prisma.$executeRaw,
  prisma.$executeRawUnsafe,
];

beforeEach(() => {
  vi.clearAllMocks();
  log.length = 0;
  calcRow.stageDependencies = [];
  vi.mocked(requireApiRole).mockResolvedValue(session('architect'));
  vi.mocked(prisma.calculation.findMany).mockResolvedValue([calcRow] as never);
  vi.mocked(prisma.calculation.findUnique).mockResolvedValue(calcRow as never);
  vi.mocked(prisma.roleCapacity.findMany).mockResolvedValue([
    { role: 'architect', headcount: 1, hoursPerWeek: 10, effectiveFrom: d('2026-01-05') },
  ] as never);
  vi.mocked(prisma.roleReservation.findMany).mockResolvedValue([]);
  vi.mocked(prisma.workCalendar.findMany).mockResolvedValue([calendarRow] as never);
});

describe('what-if варианты ничего не пишут', () => {
  it('сравнение сдвига, подрядчика и команды — только чтение', async () => {
    const res = await whatIf(
      json('http://localhost/api/capacity/what-if', {
        from: '2026-03-02',
        weeks: 6,
        variants: [
          { label: 'Позже', changes: [{ type: 'shift', calculationId: 'c1', shiftDays: 14 }] },
          {
            label: 'Подрядчик',
            changes: [{ type: 'contractor', calculationId: 'c1', role: 'architect', share: 1 }],
          },
          {
            label: 'Команда',
            changes: [
              {
                type: 'team',
                role: 'architect',
                headcountDelta: 1,
                from: '2026-03-02',
                to: '2026-03-08',
              },
            ],
          },
        ],
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.variants).toHaveLength(3);
    expect(body.baseline.overWeeks).toBeGreaterThan(0);
    expect(body.variants[1].overWeeks).toBe(0);
    for (const spy of writeSpies()) expect(spy).not.toHaveBeenCalled();
  });

  it('прежний формат shifts — матрица, тоже без записи', async () => {
    const res = await whatIf(
      json('http://localhost/api/capacity/what-if', {
        from: '2026-03-02',
        weeks: 4,
        shifts: [{ calculationId: 'c1', shiftDays: 7 }],
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.weeks).toHaveLength(4);
    for (const spy of writeSpies()) expect(spy).not.toHaveBeenCalled();
  });

  it('неверный вариант — 400; пресейл — 403', async () => {
    const bad = await whatIf(
      json('http://localhost/api/capacity/what-if', { variants: [{ changes: [{ type: 'x' }] }] }),
    );
    expect(bad.status).toBe(400);
    vi.mocked(requireApiRole).mockResolvedValue(NextResponse.json({ error: 'x' }, { status: 403 }));
    const denied = await whatIf(json('http://localhost/api/capacity/what-if', { variants: [] }));
    expect(denied.status).toBe(403);
  });
});

describe('применение сдвига учитывает календарь и зависимости', () => {
  it('перенос на 14 дней перестраивает Гант: праздник 16.03 сдвигает этапы', async () => {
    const res = await apply(
      json('http://localhost/api/capacity/apply', {
        shifts: [{ calculationId: 'c1', shiftDays: 14 }],
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.applied).toHaveLength(1);
    const ops = log;
    const byId = Object.fromEntries(
      ops.filter((o) => o.op === 'stage.update').map((o) => [o.args.where.id, o.args.data]),
    );
    // Сдвиг «на целые дни» дал бы пн 16.03 09:00; по календарю это праздник → вт 17.03.
    expect(byId.sA.startDate.toISOString()).toBe('2026-03-17T09:00:00.000Z');
    expect(byId.sA.endDate.toISOString()).toBe('2026-03-18T15:00:00.000Z');
    expect(byId.sB.endDate.toISOString()).toBe('2026-03-19T15:00:00.000Z');
    expect(ops.find((o) => o.op === 'calculation.update')?.args.data.startDate.toISOString()).toBe(
      '2026-03-16T00:00:00.000Z',
    );
  });

  it('явная зависимость с паузой сохраняется при переносе', async () => {
    calcRow.stageDependencies = [{ fromStageId: 'sA', toStageId: 'sB', type: 'FS', lagDays: 1 }];
    await apply(
      json('http://localhost/api/capacity/apply', {
        shifts: [{ calculationId: 'c1', shiftDays: 14 }],
      }),
    );
    const ops = log;
    const b = ops.find((o) => o.op === 'stage.update' && o.args.where.id === 'sB')!;
    // A кончается в ср 18.03 15:00, пауза чт 19.03 → B в пт 20.03.
    expect(b.args.data.startDate.toISOString()).toBe('2026-03-20T09:00:00.000Z');
  });
});

describe('зависимости этапов: маршрут', () => {
  const put = (deps: unknown) =>
    putDependencies(
      json('http://localhost/api/calculations/c1/dependencies', { dependencies: deps }, 'PUT'),
      { params: Promise.resolve({ id: 'c1' }) },
    );

  beforeEach(() => {
    vi.mocked(prisma.calculation.findUnique).mockResolvedValue({
      ...calcRow,
      status: 'draft',
    } as never);
  });

  it('цикл отклоняется до записи (409)', async () => {
    const res = await put([
      { fromStageId: 'sA', toStageId: 'sB' },
      { fromStageId: 'sB', toStageId: 'sA' },
    ]);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/цикл/);
    // Проверка — под блокировкой расчёта, но до любой записи.
    expect(log.map((o) => o.op)).toEqual(['lock']);
  });

  it('зависимость от этапа ниже по списку — 409', async () => {
    const res = await put([{ fromStageId: 'sB', toStageId: 'sA' }]);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/выше по списку/);
    expect(log.map((o) => o.op)).toEqual(['lock']);
  });

  it('петля, чужой этап, неверная пауза — 400', async () => {
    expect((await put([{ fromStageId: 'sA', toStageId: 'sA' }])).status).toBe(400);
    expect((await put([{ fromStageId: 'zz', toStageId: 'sB' }])).status).toBe(400);
    expect((await put([{ fromStageId: 'sA', toStageId: 'sB', lagDays: -2 }])).status).toBe(400);
    expect((await put([{ fromStageId: 'sA', toStageId: 'sB', type: 'SS' }])).status).toBe(400);
    expect(log.every((o) => o.op === 'lock')).toBe(true);
  });

  it('утверждённый расчёт — 409', async () => {
    vi.mocked(prisma.calculation.findUnique).mockResolvedValue(calcRow as never);
    expect((await put([])).status).toBe(409);
  });

  it('сохранение заменяет набор и перестраивает даты одной транзакцией', async () => {
    const res = await put([{ fromStageId: 'sA', toStageId: 'sB', lagDays: 2 }]);
    expect(res.status).toBe(200);
    expect(log.map((o) => o.op)).toEqual([
      'lock',
      'stageDependency.deleteMany',
      'stageDependency.create',
      'calculation.update',
      'stage.update',
      'stage.update',
    ]);
  });
});

describe('ближайшая дата старта: маршрут', () => {
  it('ищет дату по ёмкости и ничего не пишет', async () => {
    const res = await earliestStart(
      new NextRequest('http://localhost/api/calculations/c1/earliest-start?from=2026-03-02'),
      { params: Promise.resolve({ id: 'c1' }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // 18 ч архитектора при ёмкости 10 ч/нед не помещаются ни в одну неделю.
    expect(body.startDate).toBeNull();
    expect(body.conflictAtFrom).toMatchObject({ role: 'architect' });
    for (const spy of writeSpies()) expect(spy).not.toHaveBeenCalled();
  });

  it('некорректная дата — 400', async () => {
    const res = await earliestStart(
      new NextRequest('http://localhost/api/calculations/c1/earliest-start?from=garbage'),
      { params: Promise.resolve({ id: 'c1' }) },
    );
    expect(res.status).toBe(400);
  });
});
