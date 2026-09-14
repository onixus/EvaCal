import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { GET as getCapacity } from '@/app/api/capacity/route';
import { POST as createCapacity, DELETE as deleteCapacity } from '@/app/api/admin/capacity/route';

vi.mock('@/lib/auth', () => ({ requireApiRole: vi.fn() }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(), clientIp: vi.fn(() => '127.0.0.1') }));
vi.mock('@/lib/capacityData', async (orig) => ({
  ...(await orig<typeof import('@/lib/capacityData')>()),
  loadCapacityMatrix: vi.fn(async () => ({ weeks: [], roles: [], included: [], generatedAt: '' })),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    roleCapacity: { create: vi.fn(), findUnique: vi.fn(), delete: vi.fn(), findMany: vi.fn() },
  },
}));

import { requireApiRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { loadCapacityMatrix, parseCapacityQuery } from '@/lib/capacityData';

const session = (role: string) => ({ userId: 'u1', username: 'x', role, exp: 0 });
const post = (body: unknown) =>
  new NextRequest('http://localhost/api/admin/capacity', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });

describe('ресурсный план: маршруты', () => {
  beforeEach(() => vi.clearAllMocks());

  it('пресейл не видит план (чужие проекты)', async () => {
    vi.mocked(requireApiRole).mockResolvedValue(NextResponse.json({ error: 'x' }, { status: 403 }));
    const res = await getCapacity(new NextRequest('http://localhost/api/capacity'));
    expect(res.status).toBe(403);
    expect(loadCapacityMatrix).not.toHaveBeenCalled();
  });

  it('параметры запроса: горизонт режется до 52 недель, роли через запятую', () => {
    const q = parseCapacityQuery(
      new URLSearchParams('weeks=99&roles=engineer,analyst&drafts=1&from=2026-03-02'),
    );
    expect(q.weeks).toBe(52);
    expect(q.roles).toEqual(['engineer', 'analyst']);
    expect(q.includeDrafts).toBe(true);
    expect(q.from?.toISOString().slice(0, 10)).toBe('2026-03-02');
    expect(parseCapacityQuery(new URLSearchParams('from=garbage')).from).toBeUndefined();
  });

  it('ёмкость: пишет только админ, роль заказчика и кривые числа отклоняются', async () => {
    vi.mocked(requireApiRole).mockResolvedValue(NextResponse.json({ error: 'x' }, { status: 403 }));
    expect(
      (await createCapacity(post({ role: 'engineer', headcount: 1, effectiveFrom: '2026-01-01' })))
        .status,
    ).toBe(403);

    vi.mocked(requireApiRole).mockResolvedValue(session('admin'));
    expect(
      (await createCapacity(post({ role: 'customer', headcount: 1, effectiveFrom: '2026-01-01' })))
        .status,
    ).toBe(400);
    expect(
      (await createCapacity(post({ role: 'engineer', headcount: -1, effectiveFrom: '2026-01-01' })))
        .status,
    ).toBe(400);
    expect(
      (
        await createCapacity(
          post({ role: 'engineer', headcount: 1, hoursPerWeek: 100, effectiveFrom: '2026-01-01' }),
        )
      ).status,
    ).toBe(400);
    expect(
      (await createCapacity(post({ role: 'engineer', headcount: 1, effectiveFrom: 'nope' })))
        .status,
    ).toBe(400);

    vi.mocked(prisma.roleCapacity.create).mockResolvedValue({ id: 'r1' } as never);
    const ok = await createCapacity(
      post({ role: 'engineer', headcount: 2.5, effectiveFrom: '2026-03-02' }),
    );
    expect(ok.status).toBe(201);
    const call = vi.mocked(prisma.roleCapacity.create).mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(call.data).toMatchObject({
      role: 'engineer',
      headcount: 2.5,
      hoursPerWeek: 30,
      createdBy: 'u1',
    });
  });

  it('удаление несуществующей строки — 404', async () => {
    vi.mocked(requireApiRole).mockResolvedValue(session('admin'));
    vi.mocked(prisma.roleCapacity.findUnique).mockResolvedValue(null);
    const res = await deleteCapacity(
      new NextRequest('http://localhost/api/admin/capacity?id=zzz', { method: 'DELETE' }),
    );
    expect(res.status).toBe(404);
  });
});
