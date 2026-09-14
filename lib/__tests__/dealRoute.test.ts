import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { PATCH as patchDeal } from '@/app/api/projects/[id]/deal/route';
import { PATCH as patchStage } from '@/app/api/calculations/[id]/stages/[stageId]/route';

vi.mock('@/lib/auth', () => ({ requireApiRole: vi.fn() }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(), clientIp: vi.fn(() => '127.0.0.1') }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    project: { findUnique: vi.fn(), update: vi.fn() },
    calculation: { findUnique: vi.fn() },
    stage: { findUnique: vi.fn(), update: vi.fn(), count: vi.fn(async () => 0) },
  },
}));

import { requireApiRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const session = (role: string) => ({ userId: 'u1', username: 'x', role, exp: 0 });
const req = (body: unknown) =>
  new NextRequest('http://localhost/x', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });

describe('PATCH /api/projects/:id/deal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('ревьювер не закрывает сделки', async () => {
    vi.mocked(requireApiRole).mockResolvedValue(
      NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 }),
    );
    const res = await patchDeal(req({ dealStatus: 'won' }), {
      params: Promise.resolve({ id: 'p1' }),
    });
    expect(res.status).toBe(403);
  });

  it('won без утверждённого расчёта — 409', async () => {
    vi.mocked(requireApiRole).mockResolvedValue(session('presale'));
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      id: 'p1',
      dealStatus: 'open',
      actualsClosedAt: null,
      calculations: [{ id: 'c1', status: 'draft', currency: 'RUB' }],
    } as never);
    const res = await patchDeal(req({ dealStatus: 'won' }), {
      params: Promise.resolve({ id: 'p1' }),
    });
    expect(res.status).toBe(409);
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it('won с утверждённым расчётом пишет версию и сумму', async () => {
    vi.mocked(requireApiRole).mockResolvedValue(session('presale'));
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      id: 'p1',
      dealStatus: 'open',
      actualsClosedAt: null,
      calculations: [{ id: 'c1', status: 'approved', currency: 'RUB' }],
    } as never);
    vi.mocked(prisma.project.update).mockResolvedValue({ id: 'p1' } as never);
    const res = await patchDeal(req({ dealStatus: 'won', contractAmount: 500000 }), {
      params: Promise.resolve({ id: 'p1' }),
    });
    expect(res.status).toBe(200);
    const call = vi.mocked(prisma.project.update).mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(call.data).toMatchObject({
      dealStatus: 'won',
      wonCalculationId: 'c1',
      contractAmount: 500000,
      contractCurrency: 'RUB',
      dealClosedBy: 'u1',
    });
  });
});

describe('PATCH /api/calculations/:id/stages/:stageId — факт', () => {
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

  it('факт по невыигранной версии — 409', async () => {
    vi.mocked(requireApiRole).mockResolvedValue(session('architect'));
    vi.mocked(prisma.calculation.findUnique).mockResolvedValue(
      wonCalc({ wonCalculationId: 'other' }),
    );
    const res = await patchStage(req({ actualHours: 5 }), {
      params: Promise.resolve({ id: 'c1', stageId: 's1' }),
    });
    expect(res.status).toBe(409);
  });

  it('после закрытия факта архитектор получает 403, админ пишет', async () => {
    vi.mocked(prisma.calculation.findUnique).mockResolvedValue(
      wonCalc({ actualsClosedAt: new Date() }),
    );
    vi.mocked(prisma.stage.findUnique).mockResolvedValue({
      id: 's1',
      calculationId: 'c1',
    } as never);
    vi.mocked(prisma.stage.update).mockResolvedValue({ id: 's1', actualHours: 5 } as never);

    vi.mocked(requireApiRole).mockResolvedValue(session('architect'));
    let res = await patchStage(req({ actualHours: 5 }), {
      params: Promise.resolve({ id: 'c1', stageId: 's1' }),
    });
    expect(res.status).toBe(403);

    vi.mocked(requireApiRole).mockResolvedValue(session('admin'));
    res = await patchStage(req({ actualHours: 5 }), {
      params: Promise.resolve({ id: 'c1', stageId: 's1' }),
    });
    expect(res.status).toBe(200);
    expect(prisma.stage.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { actualHours: 5 },
    });
  });

  it('статус этапа по-прежнему меняется без проверки факта', async () => {
    vi.mocked(requireApiRole).mockResolvedValue(session('architect'));
    vi.mocked(prisma.stage.findUnique).mockResolvedValue({
      id: 's1',
      calculationId: 'c1',
    } as never);
    vi.mocked(prisma.stage.update).mockResolvedValue({ id: 's1', status: 'done' } as never);
    const res = await patchStage(req({ status: 'done' }), {
      params: Promise.resolve({ id: 'c1', stageId: 's1' }),
    });
    expect(res.status).toBe(200);
    expect(prisma.calculation.findUnique).not.toHaveBeenCalled();
  });

  it('отрицательный факт — 400', async () => {
    vi.mocked(requireApiRole).mockResolvedValue(session('architect'));
    vi.mocked(prisma.calculation.findUnique).mockResolvedValue(wonCalc());
    const res = await patchStage(req({ actualHours: -1 }), {
      params: Promise.resolve({ id: 'c1', stageId: 's1' }),
    });
    expect(res.status).toBe(400);
  });
});
