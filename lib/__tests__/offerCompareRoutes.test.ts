import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { GET as getCompare } from '@/app/api/projects/[id]/compare/route';
import { PATCH as patchStage } from '@/app/api/calculations/[id]/stages/[stageId]/route';
import { PATCH as patchActuals } from '@/app/api/calculations/[id]/actuals/route';

vi.mock('@/lib/auth', () => ({ requireApiRole: vi.fn() }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(), clientIp: vi.fn(() => '127.0.0.1') }));
vi.mock('@/lib/prisma', () => {
  const prisma = {
    project: { findUnique: vi.fn() },
    calculation: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    stage: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
    costItem: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  return { prisma };
});
vi.mock('@/lib/actualsLedgerData', () => ({
  recordManualStageEdit: vi.fn(),
  isLedgerConflict: vi.fn(() => false),
  loadLedgerOverview: vi.fn(),
}));

import { requireApiRole } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';

const session = (role: string) => ({ userId: 'u1', username: 'ivanov', role, exp: 0 });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const stageParams = { params: Promise.resolve({ id: 'c1', stageId: 's1' }) };
const patch = (body: unknown) =>
  new NextRequest('http://localhost/x', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });

const calcRow = (id: string, version: number, rates: string, projectId = 'p1') => ({
  id,
  projectId,
  version,
  name: `v${version}`,
  status: 'approved',
  versionComment: null,
  createdAt: new Date('2026-10-01'),
  startDate: new Date('2026-11-02'),
  pmHours: 0,
  currency: 'RUB',
  roleRates: rates,
  overheadPercent: 0,
  pricingMode: 'markup',
  marginPercent: 20,
  discountPercent: 0,
  vatPercent: 20,
  includeVat: true,
  stages: [
    {
      name: 'Разработка',
      role: 'developer',
      hours: 10,
      isApprovalTask: false,
      startDate: new Date('2026-11-02'),
      endDate: new Date('2026-11-06'),
    },
  ],
  risks: [],
  specifications: [
    {
      version: 2,
      status: 'draft',
      data: '{}',
    },
    {
      version: 1,
      status: 'confirmed',
      data: JSON.stringify({ version: 1, status: 'confirmed', emptySupplyReason: '', items: [] }),
    },
  ],
});

describe('GET /api/projects/:id/compare', () => {
  beforeEach(() => vi.clearAllMocks());
  const get = (query: string) =>
    new NextRequest(`http://localhost/api/projects/p1/compare${query}`);

  it('техписатель не видит коммерческие цифры', async () => {
    vi.mocked(requireApiRole).mockResolvedValue(
      NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 }),
    );
    const res = await getCompare(get('?ids=a,b'), params('p1'));
    expect(res.status).toBe(403);
    expect(requireApiRole).toHaveBeenCalledWith(['presale', 'architect', 'reviewer', 'admin']);
  });

  it('меньше двух версий — 400', async () => {
    vi.mocked(requireApiRole).mockResolvedValue(session('presale') as never);
    const res = await getCompare(get('?ids=a,a'), params('p1'));
    expect(res.status).toBe(400);
  });

  it('версия чужого проекта — 400, неизвестный проект — 404', async () => {
    vi.mocked(requireApiRole).mockResolvedValue(session('presale') as never);
    vi.mocked(prisma.project.findUnique).mockResolvedValue({ id: 'p1' } as never);
    vi.mocked(prisma.calculation.findMany).mockResolvedValue([
      calcRow('a', 1, '{}'),
      calcRow('b', 2, '{}', 'p2'),
    ] as never);
    expect((await getCompare(get('?ids=a,b'), params('p1'))).status).toBe(400);

    vi.mocked(prisma.project.findUnique).mockResolvedValue(null);
    expect((await getCompare(get('?ids=a,b'), params('p1'))).status).toBe(404);
  });

  it('считает по сохранённым ставкам каждой версии в порядке запроса', async () => {
    vi.mocked(requireApiRole).mockResolvedValue(session('reviewer') as never);
    vi.mocked(prisma.project.findUnique).mockResolvedValue({ id: 'p1' } as never);
    vi.mocked(prisma.calculation.findMany).mockResolvedValue([
      calcRow('a', 1, '{"developer":1000}'),
      calcRow('b', 2, '{"developer":2000}'),
    ] as never);
    const res = await getCompare(get('?ids=b,a'), params('p1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.baselineId).toBe('b');
    expect(body.variants.map((v: { money: { totalCost: number } }) => v.money.totalCost)).toEqual([
      20000, 10000,
    ]);
    expect(body.variants[1].delta.totalCost).toBe(-10000);
    // Последняя редакция — черновик: сравнивается подтверждённая v1.
    expect(body.variants[0].specification).toMatchObject({ state: 'confirmed', version: 1 });
  });
});

describe('оценка оставшейся работы', () => {
  beforeEach(() => vi.clearAllMocks());

  const wonCalc = (over: Record<string, unknown> = {}) =>
    ({
      id: 'c1',
      project: {
        id: 'p1',
        dealStatus: 'won',
        wonCalculationId: 'c1',
        actualsClosedAt: null,
        ...over,
      },
    }) as never;

  it('только по выигранной версии', async () => {
    vi.mocked(requireApiRole).mockResolvedValue(session('architect') as never);
    vi.mocked(prisma.calculation.findUnique).mockResolvedValue(
      wonCalc({ wonCalculationId: 'other' }),
    );
    const res = await patchStage(patch({ remainingHoursEstimate: 5 }), stageParams);
    expect(res.status).toBe(409);
    expect(prisma.stage.update).not.toHaveBeenCalled();
  });

  it('отрицательная оценка — 400', async () => {
    vi.mocked(requireApiRole).mockResolvedValue(session('architect') as never);
    vi.mocked(prisma.calculation.findUnique).mockResolvedValue(wonCalc());
    const res = await patchStage(patch({ remainingHoursEstimate: -1 }), stageParams);
    expect(res.status).toBe(400);
  });

  it('пишет оценку с автором и временем; null снимает оценку целиком', async () => {
    vi.mocked(requireApiRole).mockResolvedValue(session('architect') as never);
    vi.mocked(prisma.calculation.findUnique).mockResolvedValue(wonCalc());
    vi.mocked(prisma.stage.findUnique).mockResolvedValue({
      id: 's1',
      calculationId: 'c1',
      isApprovalTask: false,
      remainingHoursEstimate: null,
    } as never);
    vi.mocked(prisma.stage.update).mockResolvedValue({
      id: 's1',
      remainingHoursEstimate: 12,
    } as never);
    let res = await patchStage(patch({ remainingHoursEstimate: 12 }), stageParams);
    expect(res.status).toBe(200);
    const data = vi.mocked(prisma.stage.update).mock.calls[0][0].data as Record<string, unknown>;
    expect(data.remainingHoursEstimate).toBe(12);
    expect(data.remainingEstimatedBy).toBe('ivanov');
    expect(data.remainingEstimatedAt).toBeInstanceOf(Date);
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'stage.remaining_estimate' }),
    );

    res = await patchStage(patch({ remainingHoursEstimate: null }), stageParams);
    expect(res.status).toBe(200);
    expect(vi.mocked(prisma.stage.update).mock.calls[1][0].data).toMatchObject({
      remainingHoursEstimate: null,
      remainingEstimatedBy: null,
      remainingEstimatedAt: null,
    });
  });

  it('задачу согласования не оценивают', async () => {
    vi.mocked(requireApiRole).mockResolvedValue(session('architect') as never);
    vi.mocked(prisma.calculation.findUnique).mockResolvedValue(wonCalc());
    vi.mocked(prisma.stage.findUnique).mockResolvedValue({
      id: 's1',
      calculationId: 'c1',
      isApprovalTask: true,
    } as never);
    const res = await patchStage(patch({ remainingHoursEstimate: 3 }), stageParams);
    expect(res.status).toBe(400);
  });

  it('остаток часов РП пишется отдельно от факта РП', async () => {
    vi.mocked(requireApiRole).mockResolvedValue(session('admin') as never);
    vi.mocked(prisma.calculation.findUnique).mockResolvedValue(wonCalc());
    const res = await patchActuals(patch({ remainingPmHoursEstimate: 6 }), params('c1'));
    expect(res.status).toBe(200);
    const data = vi.mocked(prisma.calculation.update).mock.calls[0][0].data as Record<
      string,
      unknown
    >;
    expect(data).toMatchObject({ remainingPmHoursEstimate: 6, remainingPmEstimatedBy: 'ivanov' });
    expect(data).not.toHaveProperty('actualPmHours');
    expect(
      (await patchActuals(patch({ remainingPmHoursEstimate: 'x' }), params('c1'))).status,
    ).toBe(400);
  });

  it('пробелы, нечисловые строки и массивы — 400', async () => {
    vi.mocked(requireApiRole).mockResolvedValue(session('architect') as never);
    vi.mocked(prisma.calculation.findUnique).mockResolvedValue(wonCalc());
    for (const bad of [' ', 'abc', [3], true]) {
      const res = await patchStage(patch({ remainingHoursEstimate: bad }), stageParams);
      expect(res.status).toBe(400);
      expect(
        (await patchActuals(patch({ remainingPmHoursEstimate: bad }), params('c1'))).status,
      ).toBe(400);
      expect((await patchActuals(patch({ actualPmHours: bad }), params('c1'))).status).toBe(400);
    }
    expect(prisma.stage.update).not.toHaveBeenCalled();
    expect(prisma.calculation.update).not.toHaveBeenCalled();
  });

  it('оценка запоминает факт этапа на момент подтверждения', async () => {
    vi.mocked(requireApiRole).mockResolvedValue(session('architect') as never);
    vi.mocked(prisma.calculation.findUnique).mockResolvedValue(wonCalc());
    vi.mocked(prisma.stage.findUnique).mockResolvedValue({
      id: 's1',
      calculationId: 'c1',
      isApprovalTask: false,
      actualHours: 14,
      remainingHoursEstimate: null,
    } as never);
    vi.mocked(prisma.stage.update).mockResolvedValue({ id: 's1' } as never);
    await patchStage(patch({ remainingHoursEstimate: '6' }), stageParams);
    expect(vi.mocked(prisma.stage.update).mock.calls[0][0].data).toMatchObject({
      remainingHoursEstimate: 6,
      remainingActualBaseline: 14,
    });
  });

  it('оценка РП запоминает факт РП; аудит хранит было/стало', async () => {
    vi.mocked(requireApiRole).mockResolvedValue(session('admin') as never);
    vi.mocked(prisma.calculation.findUnique).mockResolvedValue({
      ...(wonCalc() as object),
      actualPmHours: 3,
      remainingPmHoursEstimate: 2,
    } as never);
    await patchActuals(patch({ remainingPmHoursEstimate: 5 }), params('c1'));
    expect(vi.mocked(prisma.calculation.update).mock.calls[0][0].data).toMatchObject({
      remainingPmHoursEstimate: 5,
      remainingPmActualBaseline: 3,
    });
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'calculation.remainingPm', meta: { from: 2, to: 5 } }),
    );

    vi.mocked(prisma.calculation.update).mockClear();
    await patchActuals(patch({ actualPmHours: 7, remainingPmHoursEstimate: 1 }), params('c1'));
    expect(vi.mocked(prisma.calculation.update).mock.calls[0][0].data).toMatchObject({
      actualPmHours: 7,
      remainingPmActualBaseline: 7,
    });
  });
});
